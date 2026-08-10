import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, CHAT_MODEL, type FieldToCollect } from './_lib/anthropic.js';
import { getSupabaseAdmin, describeDbError } from './_lib/supabase.js';
import { normalizePhone, normalizeEmail } from './_lib/contacts.js';

interface SummarizeBody {
  conversation_id?: string;
}

interface DbMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Build a strict JSON schema from the pro's fields_to_collect. Every field is
 * required and nullable, so the model returns the key with a value or `null` —
 * never omits it, never invents data.
 */
function buildSummarySchema(fields: FieldToCollect[]) {
  if (fields.length === 0) {
    return {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Short summary of the conversation' } },
      required: ['summary'],
      additionalProperties: false,
    };
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.key] = {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: f.label,
    };
    required.push(f.key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * POST /api/summarize — Step 6: extract a structured summary and close the
 * conversation.
 *
 * Body: { conversation_id }
 * Returns: { summary }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversation_id } = (req.body ?? {}) as SummarizeBody;
  if (!conversation_id) {
    return res.status(400).json({ error: 'conversation_id is required' });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Resolve conversation → pro config (fields_to_collect).
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, profile_id, profiles ( intake_config )')
      .eq('id', conversation_id)
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) return res.status(404).json({ error: 'Unknown conversation' });

    const profileRel = conv.profiles as { intake_config?: unknown } | { intake_config?: unknown }[] | null;
    const profile = Array.isArray(profileRel) ? profileRel[0] : profileRel;
    const cfg = (profile?.intake_config ?? {}) as { fields_to_collect?: FieldToCollect[] };
    const fields = cfg.fields_to_collect ?? [];

    // Load the transcript.
    const { data: msgs, error: msgErr } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true });
    if (msgErr) throw msgErr;

    const transcript = ((msgs ?? []) as DbMessage[])
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`)
      .join('\n');

    // Extract structured data via Structured Outputs (json_schema, enforced shape).
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 1024,
      system:
        'You extract structured intake information from a conversation between a visitor and an intake assistant. ' +
        'For each field, use the value the visitor actually provided, or null if they did not provide it. ' +
        'Never invent information.',
      messages: [
        {
          role: 'user',
          content: `Conversation:\n${transcript || '(no messages)'}\n\nExtract the intake fields.`,
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: buildSummarySchema(fields),
        },
      },
    });

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    let summary: unknown;
    try {
      summary = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'Model did not return valid JSON' });
    }

    // Persist + close the conversation.
    const { error: updErr } = await supabase
      .from('conversations')
      .update({
        summary,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', conversation_id);
    if (updErr) throw updErr;

    // Record the contact so a returning visitor is recognised next time.
    // The summary is already saved, so a contact failure must not fail the
    // request — but it must still be awaited (see recordContact).
    try {
      await recordContact(supabase, conv.profile_id, summary);
    } catch (contactErr) {
      console.error('contact upsert failed:', describeDbError(contactErr));
    }

    return res.status(200).json({ summary });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited, try again shortly' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: 'AI request failed' });
    }
    // Public endpoint: log the detail, return a generic message. Internal error
    // text can carry table names, constraint values and visitor data.
    console.error('summarize failed:', err instanceof Error ? err.message : describeDbError(err));
    return res.status(500).json({ error: 'Could not summarise this conversation' });
  }
}

interface ContactRow {
  id: string;
  visit_count: number;
}

/** First summary value whose key matches `re`, as a trimmed string. */
function pickField(summary: Record<string, unknown>, re: RegExp): string | null {
  const hit = Object.entries(summary).find(([k]) => re.test(k));
  if (!hit || typeof hit[1] !== 'string') return null;
  return hit[1].trim() || null;
}

/**
 * Create or refresh the `contacts` row for this visitor, bumping `visit_count`.
 * This is the only place that owns `visit_count` — /api/chat reads contacts but
 * never writes them, so a single completed conversation counts exactly once.
 *
 * NOTE: supabase-js query builders are thenables — the HTTP request is only
 * issued from `then()`. Every call below must be awaited or nothing is sent.
 */
async function recordContact(
  supabase: SupabaseClient,
  profileId: string,
  summary: unknown,
): Promise<void> {
  if (typeof summary !== 'object' || summary === null) return;
  const fields = summary as Record<string, unknown>;

  const phone = normalizePhone(pickField(fields, /phone|t[ée]l/i));
  const email = normalizeEmail(pickField(fields, /e-?mail/i));
  const fullName = pickField(fields, /name|nom/i);
  if (!phone && !email) return;

  // (profile_id, phone_normalized) and (profile_id, email_normalized) are both
  // unique, so an upsert keyed on one can violate the other when a visitor
  // gives a new phone for an email we already know. Resolve the row first.
  // Two `.eq()` lookups rather than one `.or()`: these values come from model
  // output and must never be interpolated into a PostgREST filter expression.
  let existing: ContactRow | null = null;

  for (const [column, value] of [
    ['phone_normalized', phone],
    ['email_normalized', email],
  ] as const) {
    if (!value || existing) continue;
    const { data, error } = await supabase
      .from('contacts')
      .select('id, visit_count')
      .eq('profile_id', profileId)
      .eq(column, value)
      .maybeSingle();
    if (error) throw error;
    existing = (data as ContactRow | null) ?? null;
  }

  const now = new Date().toISOString();

  if (existing) {
    // Only overwrite identifiers we actually captured this time.
    const patch: Record<string, unknown> = {
      last_summary: summary,
      visit_count: existing.visit_count + 1,
      last_seen: now,
    };
    if (phone) patch.phone_normalized = phone;
    if (email) patch.email_normalized = email;
    if (fullName) patch.full_name = fullName;

    const { error } = await supabase.from('contacts').update(patch).eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('contacts').insert({
    profile_id: profileId,
    phone_normalized: phone,
    email_normalized: email,
    full_name: fullName,
    last_summary: summary,
    visit_count: 1,
    last_seen: now,
  });
  if (error) throw error;
}
