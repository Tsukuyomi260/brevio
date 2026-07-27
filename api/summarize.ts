import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, CHAT_MODEL, type FieldToCollect } from './_lib/anthropic';
import { getSupabaseAdmin } from './_lib/supabase';
import { normalizePhone, normalizeEmail } from './_lib/contacts';

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

    // Upsert into contacts for recurring client detection (fire-and-forget).
    // Extract identifiers from summary.
    const summary_obj = typeof summary === 'object' ? (summary as Record<string, unknown>) : {};
    const nameField = Object.entries(summary_obj).find(([k]) =>
      /name|nom/i.test(k)
    );
    const phoneField = Object.entries(summary_obj).find(([k]) =>
      /phone|téléphone|tel/i.test(k)
    );
    const emailField = Object.entries(summary_obj).find(([k]) =>
      /email|mail|e-mail/i.test(k)
    );

    const fullName = nameField ? String(nameField[1]) : null;
    const phoneStr = phoneField ? String(phoneField[1]) : null;
    const emailStr = emailField ? String(emailField[1]) : null;

    const phone = normalizePhone(phoneStr);
    const email = normalizeEmail(emailStr);

    // Try to upsert by phone first (higher priority), fallback to email.
    // Fire-and-forget, don't block response on contact upsert.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    if (phone) {
      supabase
        .from('contacts')
        .upsert(
          {
            profile_id: conv!.profile_id,
            phone_normalized: phone,
            email_normalized: email,
            full_name: fullName,
            last_summary: summary,
            visit_count: 1,
            last_seen: new Date().toISOString(),
          },
          { onConflict: 'profile_id,phone_normalized' }
        );
    } else if (email) {
      supabase
        .from('contacts')
        .upsert(
          {
            profile_id: conv!.profile_id,
            phone_normalized: null,
            email_normalized: email,
            full_name: fullName,
            last_summary: summary,
            visit_count: 1,
            last_seen: new Date().toISOString(),
          },
          { onConflict: 'profile_id,email_normalized' }
        );
    }

    return res.status(200).json({ summary });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited, try again shortly' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: 'AI request failed' });
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    return res.status(500).json({ error: detail });
  }
}
