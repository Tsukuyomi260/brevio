import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Server-side variables the app needs once deployed. */
const REQUIRED = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_ID_PRO',
  'STRIPE_WEBHOOK_SECRET',
  'APP_URL',
  'CRON_SECRET',
] as const;

/**
 * GET /api/hello — health check.
 *
 * With `Authorization: Bearer $CRON_SECRET` it also reports which required
 * variables are present. Presence only, never a value, and never without the
 * secret: which integrations a deployment carries is not public information.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body: Record<string, unknown> = {
    message: 'Brevio API is alive',
    time: new Date().toISOString(),
  };

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === `Bearer ${secret}`) {
    const missing = REQUIRED.filter((name) => {
      const value = process.env[name];
      // SUPABASE_URL is an accepted alias for the VITE_ one.
      if (name === 'VITE_SUPABASE_URL' && process.env.SUPABASE_URL) return false;
      return !value || value.trim() === '';
    });
    body.config = { ok: missing.length === 0, missing };
  }

  return res.status(200).json(body);
}
