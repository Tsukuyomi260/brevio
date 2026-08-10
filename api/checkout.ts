import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { requireProfile } from './_lib/auth.js';
import { getStripe, getProPriceId, getAppUrl } from './_lib/stripe.js';
import { getSupabaseAdmin, describeDbError } from './_lib/supabase.js';

/**
 * POST /api/checkout — Step 8: open a Stripe Checkout Session for the Pro plan.
 *
 * Body: none. Everything that decides what is billed, and to whom, is resolved
 * server-side from the caller's JWT and from configuration. The client cannot
 * choose the price, the customer, or the account being upgraded.
 *
 * Returns: { url } — the hosted Checkout page to redirect to.
 *
 * The subscription is NOT activated here. Checkout only collects payment; the
 * plan flips in the webhook (Step 9), which is the only source Stripe signs.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Inside the try: resolving the caller touches Supabase, which throws when
    // configuration is missing. Escaping this handler would hand the browser
    // Vercel's plain-text crash page instead of a JSON error it can read.
    const auth = await requireProfile(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const { profile } = auth;

    if (profile.plan === 'pro') {
      return res.status(409).json({ error: 'This account is already on the Pro plan' });
    }

    const stripe = getStripe();
    const supabase = getSupabaseAdmin();

    // Reuse the customer if we already made one, so repeated upgrade attempts
    // don't scatter duplicate customers across the Stripe account.
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        name: profile.business_name,
        // Only the professional's own account details go to Stripe. Nothing
        // collected from their clients is ever sent to a payment processor.
        metadata: { profile_id: profile.id },
      });
      customerId = customer.id;

      // Persist immediately: a failure after this point would otherwise orphan
      // a Stripe customer that we can never match back to this profile.
      const { error } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', profile.id);
      if (error) throw error;
    }

    const appUrl = getAppUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: getProPriceId(), quantity: 1 }],
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/dashboard?checkout=cancelled`,
      // Both are echoed back on the webhook event, letting Step 9 attribute the
      // subscription without trusting anything the browser sends.
      client_reference_id: profile.id,
      metadata: { profile_id: profile.id },
      subscription_data: { metadata: { profile_id: profile.id } },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new Error('Stripe returned a session without a URL');
    }
    return res.status(200).json({ url: session.url });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error('checkout failed:', err.type, err.code ?? '');
      return res.status(502).json({ error: 'Could not reach the payment provider' });
    }
    const message = err instanceof Error ? err.message : describeDbError(err);
    console.error('checkout failed:', message);
    // A missing environment variable is an operator problem, not a user one.
    // Saying so beats a generic failure, without naming which one is absent.
    if (message.includes('is not set')) {
      return res.status(503).json({ error: 'Billing is not configured on the server' });
    }
    return res.status(500).json({ error: 'Could not start the checkout' });
  }
}
