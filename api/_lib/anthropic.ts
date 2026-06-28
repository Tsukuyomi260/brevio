import Anthropic from '@anthropic-ai/sdk';
import { loadLocalEnv } from './env';

// Ensure .env.local is loaded before we read the key (local dev only).
loadLocalEnv();

/** Chat model — cheap, fast, good enough for conversational intake. */
export const CHAT_MODEL = 'claude-haiku-4-5';

/** Max tokens for a single chat reply (intake answers are short). */
export const CHAT_MAX_TOKENS = 500;

let client: Anthropic | null = null;

/**
 * Lazily build a single Anthropic client. The key lives only on the server
 * (Vercel Function env) and is never shipped to the browser.
 */
export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface FieldToCollect {
  key: string;
  label: string;
  required: boolean;
}

export interface IntakeContext {
  /** Pro's commercial name, e.g. "Cabinet Dupont". */
  businessName?: string;
  /** Pro's profession, e.g. "Dentist". */
  profession?: string;
  /** Pro-specific instructions (intake_config.system_prompt_addition). */
  instructions?: string;
  /** Fields the assistant must collect (intake_config.fields_to_collect). */
  fields?: FieldToCollect[];
}

/**
 * Build the layered intake system prompt:
 *   1. fixed rules (one question at a time, courteous, no professional advice)
 *   2. pro-specific context (dynamic — filled from config in a later step)
 *
 * Step 2 keeps it generic; Step 5 wires the real per-pro config + fields.
 * Sent via the Messages API `system` parameter (not as a message).
 */
export function buildSystemPrompt(ctx: IntakeContext = {}): string {
  const business = ctx.businessName?.trim() || 'a service professional';
  const profession = ctx.profession?.trim();
  const who = profession ? `${business}, who works as ${profession}` : business;

  const lines = [
    `You are a conversational intake assistant for ${who}.`,
    "Your job is to collect the information needed before the client's appointment.",
    'Rules:',
    '- Ask one question at a time.',
    '- Stay warm, concise, and professional.',
    '- Never give medical, legal, or professional advice — you only collect information.',
    '- Write in clear, natural English.',
    '- When you have gathered what you need, thank the person and let them know you are done.',
  ];

  if (ctx.instructions?.trim()) {
    lines.push('', 'Specific context for this professional:', ctx.instructions.trim());
  }

  if (ctx.fields?.length) {
    lines.push('', 'Collect the following information over the course of the conversation:');
    for (const f of ctx.fields) {
      lines.push(`- ${f.label}${f.required ? ' (required)' : ' (optional)'}`);
    }
    lines.push(
      '',
      'Once you have all the required information, thank the person and let them know you are done.',
    );
  }

  return lines.join('\n');
}
