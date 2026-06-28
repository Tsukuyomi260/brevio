import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Loud in dev so a missing .env.local is obvious, not a silent failure.
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in .env.local',
  );
}

// Browser client — uses the public anon key. All access is constrained by RLS.
export const supabase = createClient(url ?? '', anonKey ?? '');
