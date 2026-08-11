import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getStripe } from './_lib/stripe.js';
import { getSupabaseAdmin, describeDbError } from './_lib/supabase.js';

/**
 * POST /api/stripe-webhook — Step 9: the only place a plan actually changes.
 *
 * Checkout collects payment but proves nothing: its success_url is a plain URL
 * the user can type. Stripe signs these events, so this endpoint is the single
 * source of truth for `plan`, `subscription_status` and `current_period_end`.
 */

// The signature covers the exact bytes Stripe sent. Any parsing and
// re-serialising changes them, and every verification then fails.
export const config = { api: { bodyParser: false } };

/**
 * Subscription states that entitle the pro to the Pro plan.
 *
 * `past_due` is included on purpose. A renewal charge that fails puts the
 * subscription there while Stripe retries for roughly two weeks; cutting access
 * on the first failure would punish a paying customer for an expired card over
 * a weekend. Stripe moves the subscription to `canceled` or `unpaid` once it
 * gives up, and both drop out of this set — so access ends when the money
 * really has, not at the first hiccup. The dashboard flags `past_due` visibly
 * in the meantime.
 */
const ENTITLED = new Set(['active', 'trialing', 'past_due']);

const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing signature' });
  }

  // Configuration failures are separated from signature failures below: a
  // missing key is temporary and deserves a 500 so Stripe retries once it is
  // fixed, whereas a bad signature is permanent and must not be retried.
  let stripe: Stripe;
  let supabase: SupabaseClient;
  try {
    stripe = getStripe();
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error(
      'stripe-webhook: not configured —',
      err instanceof Error ? err.message : 'unknown error',
    );
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await readRawBody(req), signature, secret);
  } catch (err) {
    // Anyone can POST here. An unverified payload is discarded without a word
    // about why, and never reaches the database.
    console.error(
      'stripe-webhook: signature rejected —',
      err instanceof Error ? err.message : 'unknown error',
    );
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Claim the event. A duplicate id means a redelivery we have already applied,
  // which is a success as far as Stripe is concerned.
  const { error: claimErr } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });

  if (claimErr) {
    if (claimErr.code === '23505') {
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.error('stripe-webhook: could not claim event —', describeDbError(claimErr));
    return res.status(500).json({ error: 'Storage unavailable' });
  }

  try {
    if ((EVENTS as readonly string[]).includes(event.type)) {
      await applyEvent(stripe, supabase, event);
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    // Release the claim so the retry is not swallowed as a duplicate.
    await supabase.from('stripe_events').delete().eq('id', event.id);
    console.error(
      `stripe-webhook: ${event.type} failed —`,
      err instanceof Error ? err.message : describeDbError(err),
    );
    return res.status(500).json({ error: 'Could not process the event' });
  }
}

async function applyEvent(
  stripe: Stripe,
  supabase: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  let subscription: Stripe.Subscription | null = null;

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== 'subscription' || !session.subscription) return;
    const id =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    // Re-fetched rather than trusted from the payload: the session snapshot can
    // already be stale by the time we handle it.
    subscription = await stripe.subscriptions.retrieve(id);
  } else {
    subscription = event.data.object as Stripe.Subscription;
  }

  const profileId = await resolveProfileId(supabase, subscription);
  if (!profileId) {
    // Nothing to update. Not an error: the account may have been deleted, and
    // failing would make Stripe retry an event that can never succeed.
    console.error(`stripe-webhook: no profile for customer ${asId(subscription.customer)}`);
    return;
  }

  const status = subscription.status;
  const entitled = ENTITLED.has(status);

  const { error } = await supabase
    .from('profiles')
    .update({
      plan: entitled ? 'pro' : 'free',
      stripe_subscription_id: subscription.id,
      subscription_status: status,
      current_period_end: periodEnd(subscription),
    })
    .eq('id', profileId);
  if (error) throw error;
}

/**
 * Find the profile this subscription belongs to.
 *
 * `metadata.profile_id` is set by /api/checkout, so it is our own value, not
 * the browser's. The customer id is the fallback for subscriptions created
 * outside that flow — from the Stripe dashboard, for instance.
 */
async function resolveProfileId(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.profile_id;
  if (fromMetadata) return fromMetadata;

  const customerId = asId(subscription.customer);
  if (!customerId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

function asId(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/**
 * End of the paid period, as an ISO timestamp.
 *
 * Recent API versions moved `current_period_end` off the subscription and onto
 * its items, so both shapes are read.
 */
function periodEnd(subscription: Stripe.Subscription): string | null {
  const withLegacy = subscription as Stripe.Subscription & { current_period_end?: number };
  const seconds = withLegacy.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}
