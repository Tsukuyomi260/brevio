import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './env.js';

loadLocalEnv();

let admin: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service-role key. Bypasses RLS, so it
 * is the ONLY thing allowed to write conversations/messages. Never imported
 * into browser code. Used from Vercel Functions in Steps 5+.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error(
        'Supabase admin env not set (SUPABASE_URL / VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)',
      );
    }
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return admin;
}

/**
 * Describe a database error using only schema metadata — the SQLSTATE code and
 * the constraint name. Never the raw message.
 *
 * Postgres embeds the offending values in its errors: a unique violation on
 * `contacts` reads `Key (profile_id, phone_normalized)=(…, 0612345678) already
 * exists`. Logging that message verbatim would put visitor phone numbers and
 * e-mail addresses in the platform logs, where they are neither expected nor
 * covered by the row-level policies protecting the tables.
 */
export function describeDbError(err: unknown): string {
  if (typeof err !== 'object' || err === null) return 'unhandled database error';
  const e = err as { code?: string; message?: string };
  const constraint = e.message?.match(/constraint "([\w.]+)"/)?.[1];
  const parts = [
    e.code ? `code=${e.code}` : null,
    constraint ? `constraint=${constraint}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'unhandled database error';
}
