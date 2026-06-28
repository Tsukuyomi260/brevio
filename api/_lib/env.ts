import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

/**
 * Load `.env.local` / `.env` into process.env for local dev.
 *
 * `vercel dev` does not reliably inject `.env.local` into the Functions
 * runtime, so we load it ourselves. dotenv never overrides variables already
 * present in process.env, so production (env injected by Vercel) is untouched —
 * and on prod these files don't exist, making this a no-op.
 */
export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) config({ path });
  }
}
