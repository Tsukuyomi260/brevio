import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './env';

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
