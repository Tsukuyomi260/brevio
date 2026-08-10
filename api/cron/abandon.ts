import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin, describeDbError } from '../_lib/supabase.js';

/**
 * GET /api/cron/abandon — marks stale conversations as abandoned.
 *
 * The scheduling lives in the database (pg_cron, migration 0004) whenever the
 * extension is available. This endpoint is the fallback for projects where it
 * is not, driven by the Vercel cron entry in vercel.json, and doubles as a
 * manual trigger while testing.
 *
 * Running twice changes nothing the first run did not already do, so an overlap
 * between the two schedulers is harmless.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Missing config fails
  // closed: an unauthenticated endpoint that rewrites conversation rows is not
  // something to leave open because a variable was forgotten.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('cron/abandon: CRON_SECRET is not set');
    return res.status(500).json({ error: 'Cron not configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('abandon_stale_conversations');
    if (error) throw error;
    return res.status(200).json({ abandoned: data ?? 0 });
  } catch (err) {
    console.error('cron/abandon failed:', describeDbError(err));
    return res.status(500).json({ error: 'Could not run the sweep' });
  }
}
