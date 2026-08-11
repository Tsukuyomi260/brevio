import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { requireProfile } from './_lib/auth.js';
import { getStripe, resolveReturnOrigin } from './_lib/stripe.js';
import { describeDbError } from './_lib/supabase.js';

/**
 * POST /api/portal — open the Stripe billing portal for the signed-in pro.
 *
 * Body: none. The customer is read from the caller's own profile, so nobody can
 * open a portal onto an account that is not theirs.
 *
 * Returns: { url } — the hosted portal to redirect to.
 *
 * Stripe hosts payment-method changes and cancellations, which keeps card
 * details entirely out of this application.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await requireProfile(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const { profile } = auth;

    if (!profile.stripe_customer_id) {
      return res.status(409).json({ error: 'This account has no billing history yet' });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${resolveReturnOrigin(
        typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      )}/dashboard`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error('portal failed:', err.type, err.code ?? '');
      // The portal needs a configuration saved in the Stripe dashboard before
      // it will open. Say so, rather than reporting a generic outage.
      if (err.code === 'billing_portal_configuration_not_found' || err.type === 'StripeInvalidRequestError') {
        return res.status(503).json({ error: 'The billing portal is not configured yet' });
      }
      return res.status(502).json({ error: 'Could not reach the payment provider' });
    }
    const message = err instanceof Error ? err.message : describeDbError(err);
    console.error('portal failed:', message);
    if (message.includes('is not set')) {
      return res.status(503).json({ error: 'Billing is not configured on the server' });
    }
    return res.status(500).json({ error: 'Could not open the billing portal' });
  }
}
