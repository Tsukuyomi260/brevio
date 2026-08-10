import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

let loaded = false;

/**
 * Load `.env.local` / `.env` into process.env for local dev.
 *
 * On a deployed function these files do not exist and the platform injects the
 * environment directly, so this is a no-op there. dotenv is therefore required
 * lazily, and only once a file is actually found: a module-scope import would
 * put it on the production code path, where a resolution failure takes down the
 * whole function before its handler ever runs — and a crash at import time
 * surfaces as the platform's plain-text error page, not as anything the app can
 * catch or explain.
 *
 * Never throws. A missing loader must not stop a function whose configuration
 * was already supplied by the platform.
 */
export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  const present = ['.env.local', '.env']
    .map((file) => resolve(process.cwd(), file))
    .filter((path) => {
      try {
        return existsSync(path);
      } catch {
        return false;
      }
    });

  if (present.length === 0) return;

  try {
    // The package is ESM ("type": "module"), so `require` is not in scope.
    const { config } = createRequire(import.meta.url)('dotenv') as typeof import('dotenv');
    // dotenv never overrides what is already set, so injected values win.
    for (const path of present) config({ path });
  } catch (err) {
    console.error(
      'loadLocalEnv: could not load dotenv —',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}
