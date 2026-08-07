import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getAnthropic,
  buildSystemPrompt,
  CHAT_MODEL,
  CHAT_MAX_TOKENS,
  type FieldToCollect,
  type ReturningClient,
} from './_lib/anthropic';
import { getSupabaseAdmin } from './_lib/supabase';
import { detectIdentifiers, normalizePhone, normalizeEmail } from './_lib/contacts';

interface ChatRequestBody {
  slug?: string;
  conversation_id?: string | null;
  user_message?: string;
}

type Role = 'user' | 'assistant';
interface DbMessage {
  role: Role | 'system';
  content: string;
}

/** Free plan: max conversations per calendar month. */
const FREE_MONTHLY_QUOTA = 10;

/** Hard cap on history length sent to the model (TRD §9.4: ~30 exchanges). */
const MAX_HISTORY = 60;

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * POST /api/chat — Step 5: config-driven, server-owned conversation.
 *
 * Body: { slug, conversation_id?, user_message }
 * Returns: { conversation_id, assistant_message, is_complete }
 *
 * The server fetches the pro's config by slug, builds the full system prompt,
 * creates/loads the conversation, persists every message, and enforces the
 * Free-plan quota. The client never sees the prompt or writes the DB.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as ChatRequestBody;
  const slug = body.slug?.trim();
  const userMessage = body.user_message?.trim();
  let conversationId = body.conversation_id ?? null;

  if (!slug) return res.status(400).json({ error: 'slug is required' });
  if (!userMessage) return res.status(400).json({ error: 'user_message is required' });

  try {
    const supabase = getSupabaseAdmin();

    // 1. Resolve the pro by slug.
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, plan, business_name, profession, intake_config')
      .eq('slug', slug)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) return res.status(404).json({ error: 'Unknown intake link' });

    // 2. New conversation? Enforce the Free quota, then create it.
    if (!conversationId) {
      if (profile.plan !== 'pro') {
        const { count, error: countErr } = await supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', profile.id)
          .gte('started_at', startOfMonthISO());
        if (countErr) throw countErr;
        if ((count ?? 0) >= FREE_MONTHLY_QUOTA) {
          return res.status(402).json({
            error: 'quota_reached',
            message: 'This professional is not accepting new requests right now.',
          });
        }
      }

      const { data: created, error: createErr } = await supabase
        .from('conversations')
        .insert({ profile_id: profile.id })
        .select('id')
        .single();
      if (createErr) throw createErr;
      conversationId = created.id as string;
    } else {
      // Existing conversation must belong to this pro.
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .select('id, profile_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (convErr) throw convErr;
      if (!conv || conv.profile_id !== profile.id) {
        return res.status(404).json({ error: 'Unknown conversation' });
      }
    }

    // 3. Load prior history (ascending), then append the new user message.
    const { data: history, error: histErr } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(MAX_HISTORY);
    if (histErr) throw histErr;

    const apiMessages = ((history ?? []) as DbMessage[])
      .filter((m): m is { role: Role; content: string } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    apiMessages.push({ role: 'user', content: userMessage });

    // 3b. Recurring client detection — read-only. /api/summarize owns writes to
    //     `contacts` (including visit_count), so nothing is updated here.
    //     Only worth a lookup on the first message of a new conversation.
    let returning: ReturningClient | null = null;
    if ((history ?? []).length === 0) {
      returning = await findReturningClient(supabase, profile.id, userMessage);
    }

    // 4. Build the full per-pro system prompt and call Claude.
    const cfg = (profile.intake_config ?? {}) as {
      system_prompt_addition?: string;
      fields_to_collect?: FieldToCollect[];
    };
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: buildSystemPrompt({
        businessName: profile.business_name,
        profession: profile.profession,
        instructions: cfg.system_prompt_addition,
        fields: cfg.fields_to_collect,
        returningClient: returning ?? undefined,
      }),
      messages: apiMessages,
    });

    const assistantMessage = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!assistantMessage) {
      return res.status(502).json({ error: 'Empty response from model' });
    }

    // 5. Persist both messages (user first, then assistant — distinct timestamps
    //    keep reload order correct).
    await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'user', content: userMessage });
    await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'assistant', content: assistantMessage });

    return res.status(200).json({
      conversation_id: conversationId,
      assistant_message: assistantMessage,
      is_complete: false,
    });
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

/**
 * Look up a known contact from the identifiers in the visitor's first message.
 * Read-only: /api/summarize owns every write to `contacts`.
 *
 * Returns null on any failure — a missed greeting is not worth failing the chat.
 */
async function findReturningClient(
  supabase: SupabaseClient,
  profileId: string,
  message: string,
): Promise<ReturningClient | null> {
  const { phone, email } = detectIdentifiers(message);
  const lookupPhone = normalizePhone(phone);
  const lookupEmail = normalizeEmail(email);
  if (!lookupPhone && !lookupEmail) return null;

  try {
    // Two `.eq()` lookups rather than one `.or()`: the `or()` filter takes a
    // string expression, and a comma or paren in a value would alter it.
    for (const [column, value] of [
      ['phone_normalized', lookupPhone],
      ['email_normalized', lookupEmail],
    ] as const) {
      if (!value) continue;
      const { data, error } = await supabase
        .from('contacts')
        .select('full_name, visit_count, last_summary')
        .eq('profile_id', profileId)
        .eq(column, value)
        .maybeSingle();
      if (error) throw error;
      if (!data) continue;

      const lastSummary = (data.last_summary ?? {}) as Record<string, unknown>;
      const previousReason = lastSummary.reason ?? lastSummary.motif;
      return {
        name: typeof data.full_name === 'string' ? data.full_name : null,
        visitCount: typeof data.visit_count === 'number' ? data.visit_count : 1,
        previousReason: typeof previousReason === 'string' ? previousReason : null,
      };
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error('returning-client lookup failed:', detail);
  }
  return null;
}
