import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAnthropic,
  buildSystemPrompt,
  CHAT_MODEL,
  CHAT_MAX_TOKENS,
  type IntakeContext,
} from './_lib/anthropic';

type Role = 'user' | 'assistant';
interface ChatMessage {
  role: Role;
  content: string;
}

interface ChatRequestBody extends IntakeContext {
  messages?: unknown;
}

/** Hard cap on conversation length (TRD §9.4: 30 exchanges max). */
const MAX_MESSAGES = 60;

function isChatMessage(m: unknown): m is ChatMessage {
  if (typeof m !== 'object' || m === null) return false;
  const { role, content } = m as Record<string, unknown>;
  return (
    (role === 'user' || role === 'assistant') &&
    typeof content === 'string' &&
    content.trim().length > 0
  );
}

/**
 * POST /api/chat — Step 2: minimal Claude dialogue.
 *
 * Body: { messages: {role,content}[], businessName?, profession?, instructions? }
 * Returns: { assistant_message }
 *
 * No DB / quota / persistence yet — that arrives in Steps 3+.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as ChatRequestBody;
  const { messages, businessName, profession, instructions } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES})` });
  }
  if (!messages.every(isChatMessage)) {
    return res
      .status(400)
      .json({ error: 'each message needs role (user|assistant) and non-empty content' });
  }

  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: buildSystemPrompt({ businessName, profession, instructions }),
      messages: messages as ChatMessage[],
    });

    const assistant_message = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!assistant_message) {
      return res.status(502).json({ error: 'Empty response from model' });
    }

    return res.status(200).json({ assistant_message });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited by Anthropic, try again shortly' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: 'Anthropic request failed' });
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    // Missing key or unexpected server error.
    return res.status(500).json({ error: detail });
  }
}
