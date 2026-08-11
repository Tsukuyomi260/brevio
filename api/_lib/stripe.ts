import Stripe from 'stripe';
import { loadLocalEnv } from './env.js';

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

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '');

/**
 * Origins Checkout is allowed to send someone back to, best first.
 *
 * VERCEL_PROJECT_PRODUCTION_URL is the stable production domain; VERCEL_URL is
 * the per-deployment one and changes on every push, which is why it ranks last.
 */
function allowedOrigins(): string[] {
  const origins: string[] = [];
  const configured = process.env.APP_URL?.trim();

  if (configured) origins.push(stripTrailingSlash(configured));
  for (const host of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]) {
    if (host) origins.push(`https://${host}`);
  }
  // No Vercel environment means local development.
  if (!process.env.VERCEL) origins.push('http://localhost:5173');

  return [...new Set(origins)];
}

/** Absolute base URL for Checkout redirects when the caller's origin is unusable. */
export function getAppUrl(): string {
  return allowedOrigins()[0] ?? 'http://localhost:5173';
}

/**
 * Where to send the customer after Checkout.
 *
 * A browser session lives in localStorage, which is scoped to one origin. Return
 * someone to a different host than the one they signed in on — a preview URL, a
 * deployment URL — and they arrive logged out, which reads as a lost payment.
 * So the origin they started from is preferred.
 *
 * It is matched against the allowlist rather than trusted: the Origin header is
 * set by the caller, and putting an unchecked value in success_url would turn
 * Checkout into an open redirect. An unrecognised origin silently falls back.
 */
export function resolveReturnOrigin(origin: string | undefined): string {
  if (!origin) return getAppUrl();
  const candidate = stripTrailingSlash(origin.trim());
  return allowedOrigins().includes(candidate) ? candidate : getAppUrl();
}
