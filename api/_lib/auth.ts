import type { VercelRequest } from '@vercel/node';
import { getSupabaseAdmin } from './supabase';

/**
 * Server-side authentication for the pro-facing endpoints.
 *
 * Everything under /api was public until now, which is correct for the intake
 * flow — visitors never sign in. Anything that acts on a professional's account
 * (billing, above all) must instead prove who is calling. The identity comes
 * only from a signed Supabase JWT verified against the auth server; never from
 * a body or query parameter, which the caller controls.
 */

export interface AuthedProfile {
  id: string;
  email: string;
  business_name: string;
  plan: 'free' | 'pro';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export type AuthResult =
  | { ok: true; profile: AuthedProfile }
  | { ok: false; status: 401 | 403; error: string };

function bearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Resolve the caller's profile from their Authorization header.
 *
 * Returns a discriminated result rather than throwing, so each route decides
 * its own response shape. Failures are deliberately vague: distinguishing
 * "no such user" from "no such profile" tells an attacker which accounts exist.
 */
export async function requireProfile(req: VercelRequest): Promise<AuthResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'Authentication required' };

  const supabase = getSupabaseAdmin();

  // Validates the signature and expiry against the auth server.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, email, business_name, plan, stripe_customer_id, stripe_subscription_id')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return { ok: false, status: 403, error: 'No profile for this account' };
  }

  return { ok: true, profile: profile as AuthedProfile };
}
