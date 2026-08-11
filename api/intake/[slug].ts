import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseAdmin } from '../_lib/supabase.js';

/**
 * GET /api/intake/[slug] — public profile lookup for the intake page.
 *
 * RLS blocks anon reads of `profiles`, so this server endpoint (service role)
 * exposes ONLY the display fields a visitor needs — never the email, plan,
 * Stripe IDs, or the full system prompt.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slug = (req.query.slug as string | undefined)?.trim();
  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('profiles')
      .select('business_name, profession, logo_url, intake_config')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });

    const cfg = (data.intake_config ?? {}) as Record<string, unknown>;
    return res.status(200).json({
      business_name: data.business_name,
      profession: data.profession,
      logo_url: (data.logo_url as string) ?? null,
      assistant_name: (cfg.assistant_name as string) ?? null,
      welcome_message: (cfg.welcome_message as string) ?? null,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load intake profile' });
  }
}
