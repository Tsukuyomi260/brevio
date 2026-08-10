-- Brevio — webhook idempotency (Step 9)
-- Run in the Supabase SQL editor (or `supabase db push`).

-- Stripe guarantees at-least-once delivery: it retries on any non-2xx, and can
-- deliver the same event twice even on success. Replaying a subscription event
-- would otherwise re-apply a plan change that has since been superseded.
--
-- The webhook claims an event by inserting its id here before doing any work.
-- A duplicate insert fails on the primary key, which is the signal that the
-- event has already been handled. If the work then fails, the claim is deleted
-- so Stripe's retry can pick it up again.

create table public.stripe_events (
  id          text primary key,          -- Stripe event id, e.g. evt_1A2b3C…
  type        text not null,             -- e.g. customer.subscription.updated
  received_at timestamptz not null default now()
);

create index stripe_events_received_at_idx on public.stripe_events(received_at);

-- Only the webhook (service-role key, which bypasses RLS) touches this table.
-- RLS is enabled with no policies, so anon and authenticated clients get
-- nothing — this is billing plumbing, never exposed to a browser.
alter table public.stripe_events enable row level security;
