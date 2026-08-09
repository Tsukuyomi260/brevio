import Stripe from 'stripe';
import { loadLocalEnv } from './env';

loadLocalEnv();

let client: Stripe | null = null;

/**
 * Lazily build a single Stripe client. The secret key lives only in the Vercel
 * Function env and is never shipped to the browser — the browser only ever sees
 * the publishable key and the Checkout Session URL.
 */
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    client = new Stripe(key);
  }
  return client;
}

/** The recurring price a Free pro upgrades to. Server-side only, never taken from the client. */
export function getProPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_ID_PRO;
  if (!priceId) throw new Error('STRIPE_PRICE_ID_PRO is not set');
  return priceId;
}

/**
 * Absolute base URL for Checkout redirects.
 *
 * Deliberately not derived from the request Host or an Origin header: those are
 * caller-controlled, and feeding one into success_url would turn Checkout into
 * an open redirect. It comes from configuration, or from the deployment URL
 * Vercel injects.
 */
export function getAppUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:5173';
}
