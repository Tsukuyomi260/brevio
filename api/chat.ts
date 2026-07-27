import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAnthropic,
  buildSystemPrompt,
  CHAT_MODEL,
  CHAT_MAX_TOKENS,
  type FieldToCollect,
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

    // 3b. Recurring client detection: if we find an identifier, greet them by name.
    // Only inject on the first user message (empty history = new conversation).
    if ((history ?? []).length === 0) {
      const { phone, email, name } = detectIdentifiers(userMessage);
      const lookupPhone = phone ? normalizePhone(phone) : null;
      const lookupEmail = email ? normalizeEmail(email) : null;

      console.log(`[ContactDetection] user_message="${userMessage}" phone="${lookupPhone}" email="${lookupEmail}" name="${name}"`);

      if (lookupPhone || lookupEmail) {
        // Try to find an existing contact — handle null values properly.
        let query = supabase
          .from('contacts')
          .select('id, full_name, visit_count, last_summary')
          .eq('profile_id', profile.id);

        if (lookupPhone && lookupEmail) {
          query = query.or(`phone_normalized.eq.${lookupPhone},email_normalized.eq.${lookupEmail}`);
        } else if (lookupPhone) {
          query = query.eq('phone_normalized', lookupPhone);
        } else if (lookupEmail) {
          query = query.eq('email_normalized', lookupEmail);
        }

        const contacts = await query.maybeSingle();

        console.log(`[ContactDetection] query_error=${contacts.error?.message ?? 'none'} found=${!!contacts.data}`);

        if (!contacts.error && contacts.data) {
          // Recurring client! Inject a system note for Claude.
          const c = contacts.data;
          const greeting = name ? name : c.full_name || 'this valued client';
          let note = `The visitor is a returning client: ${greeting}. They've visited ${c.visit_count} times before.`;
          if (c.last_summary && typeof c.last_summary === 'object') {
            const prevReason = (c.last_summary as Record<string, unknown>)['reason'] ||
              (c.last_summary as Record<string, unknown>)['motif'];
            if (prevReason) {
              note += ` Last time, they came for: ${prevReason}.`;
            }
          }
          note += ' Greet them warmly by name.';
          apiMessages.unshift({ role: 'user', content: note });

          // Update visit_count and last_seen (fire-and-forget, don't block)
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          supabase
            .from('contacts')
            .update({
              visit_count: c.visit_count + 1,
              last_seen: new Date().toISOString(),
            })
            .eq('id', c.id);
        }
      }
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
