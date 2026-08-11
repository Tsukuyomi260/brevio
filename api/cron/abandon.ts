import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin, describeDbError } from '../_lib/supabase.js';

/**
 * How long a handled Stripe event id is kept for deduplication. Stripe retries
 * a failing event for about three days, so anything past this window can never
 * arrive again.
 */
const EVENT_RETENTION_DAYS = 90;

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

    // Trim the webhook deduplication log. Stripe stops retrying an event long
    // before this, so older ids can no longer prevent a replay — they would
    // only grow the table forever. Failure here must not fail the sweep.
    let purged: number | null = null;
    const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 86400_000).toISOString();
    const { data: removed, error: purgeErr } = await supabase
      .from('stripe_events')
      .delete()
      .lt('received_at', cutoff)
      .select('id');

    if (purgeErr) {
      console.error('cron/abandon: event purge failed —', describeDbError(purgeErr));
    } else {
      purged = removed?.length ?? 0;
    }

    return res.status(200).json({ abandoned: data ?? 0, events_purged: purged });
  } catch (err) {
    console.error('cron/abandon failed:', describeDbError(err));
    return res.status(500).json({ error: 'Could not run the sweep' });
  }
}
