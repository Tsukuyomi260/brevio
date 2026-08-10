import { readdirSync, statSync } from 'node:fs';
import { join, posix, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * Serves the `api/` directory from the Vite dev server, so `npm run dev` runs
 * the whole app — front end and functions — with no Vercel CLI and no cloud
 * account. `vercel dev` remains the way to rehearse the real platform.
 *
 * Handlers are loaded through `ssrLoadModule`, so they are transpiled by Vite
 * and picked up again after an edit without restarting the server.
 */

interface Route {
  /** Path segments, e.g. ['api', 'intake', '[slug]']. */
  segments: string[];
  /** Root-relative module path passed to ssrLoadModule. */
  modulePath: string;
}

/** Files and directories in `api/` that are helpers, not endpoints. */
const IGNORED = /^[._]/;

function collectRoutes(rootDir: string, apiDir: string): Route[] {
  const routes: Route[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (IGNORED.test(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|js|mts|mjs)$/.test(entry)) continue;
      const rel = full.slice(rootDir.length + 1).split(sep).join(posix.sep);
      routes.push({
        segments: rel.replace(/\.(ts|js|mts|mjs)$/, '').split(posix.sep),
        modulePath: '/' + rel,
      });
    }
  };

  walk(resolve(rootDir, apiDir));

  // Fewest dynamic segments first, so a literal path always beats a `[param]`.
  const dynamic = (r: Route) => r.segments.filter((s) => s.startsWith('[')).length;
  return routes.sort((a, b) => dynamic(a) - dynamic(b));
}

function matchRoute(
  routes: Route[],
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');

  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i];
      if (seg.startsWith('[') && seg.endsWith(']')) {
        params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
      } else if (seg !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => res(data));
    req.on('error', rej);
  });
}

/**
 * Give the Node response the small slice of the Vercel response API the
 * handlers actually use: status(), json(), send().
 */
function adaptResponse(res: ServerResponse) {
  const r = res as ServerResponse & {
    status: (code: number) => typeof r;
    json: (body: unknown) => void;
    send: (body: unknown) => void;
  };
  r.status = (code: number) => {
    r.statusCode = code;
    return r;
  };
  r.json = (body: unknown) => {
    if (!r.headersSent) r.setHeader('Content-Type', 'application/json; charset=utf-8');
    r.end(JSON.stringify(body));
  };
  r.send = (body: unknown) => {
    if (typeof body === 'object' && body !== null) return r.json(body);
    r.end(String(body ?? ''));
  };
  return r;
}

export function devApi(apiDir = 'api'): Plugin {
  return {
    name: 'brevio-dev-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;

      server.config.logger.info(
        `  ➜  API:      ${collectRoutes(root, apiDir).length} local route(s) from ${apiDir}/`,
      );

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith(`/${apiDir}/`) && url !== `/${apiDir}`) return next();

        // Rebuilt per request: adding an endpoint is a new file, and having to
        // restart the server to see it is a papercut. The tree is small.
        const parsed = new URL(url, 'http://localhost');
        const hit = matchRoute(collectRoutes(root, apiDir), parsed.pathname);
        if (!hit) return next();

        try {
          const mod = await server.ssrLoadModule(hit.route.modulePath);
          const handler = mod.default;
          if (typeof handler !== 'function') {
            throw new Error(`${hit.route.modulePath} has no default export`);
          }

          // Shape the request like @vercel/node does: merged query, parsed body.
          const query: Record<string, string> = { ...hit.params };
          parsed.searchParams.forEach((value, key) => {
            query[key] = value;
          });

          // A route may opt out of body parsing exactly as it does on Vercel,
          // via `export const config = { api: { bodyParser: false } }`. The
          // Stripe webhook needs this: its signature covers the exact bytes
          // sent, so parsing and re-serialising would invalidate every event.
          const parseBody =
            (mod.config as { api?: { bodyParser?: boolean } } | undefined)?.api?.bodyParser !== false;

          let body: unknown;
          if (parseBody && req.method && !['GET', 'HEAD'].includes(req.method)) {
            const raw = await readBody(req);
            if (raw) {
              const type = req.headers['content-type'] ?? '';
              body = type.includes('application/json') ? JSON.parse(raw) : raw;
            }
          }

          // When parsing is off the stream is left untouched, so the handler
          // can read the raw bytes itself.
          Object.assign(req, parseBody ? { query, body } : { query });
          await handler(req, adaptResponse(res));
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'unknown error';
          server.config.logger.error(`[dev-api] ${req.method} ${url} → ${detail}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
          res.end(JSON.stringify({ error: detail }));
        }
      });
    },
  };
}
