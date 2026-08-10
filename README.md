# Brevio

> **Brevio** — a conversational AI intake platform for service professionals. Collects structured client information through a guided chat (Claude), with a Free/Pro subscription flow (Stripe).

**Status:** 🚧 Step 10/10 (deploy + polish) · portfolio demo · Stripe in Test mode.

## What it does

A professional (dentist, lawyer, agent, consultant…) configures an AI assistant, gets a public link `/intake/[slug]`, and shares it with clients. Visitors chat — no signup — and the AI collects the information the pro needs before the appointment. The pro reads a structured summary in their dashboard. Usage above the free quota unlocks via a Stripe subscription.

## Tech stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS (mobile-first)
- **Backend:** Vercel Functions (serverless Node.js)
- **Database / Auth:** Supabase (PostgreSQL + Row Level Security + Auth)
- **AI:** Anthropic Claude API (`claude-haiku-4-5`, Structured Outputs for extraction)
- **Payments:** Stripe Checkout + webhooks

## Local development

Requirements: Node 18+ and npm.

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:5173 — front end AND /api/*
```

`npm run dev` runs the whole app. A small Vite plugin ([vite-dev-api.ts](vite-dev-api.ts))
serves the `api/` directory from the dev server, so no Vercel CLI and no cloud
account are needed to develop. `npm run dev:vercel` still exists to rehearse the
real platform before deploying.

### Database

Apply the migrations in order, in the Supabase SQL editor or with `supabase db push`:

| Migration | Adds |
|---|---|
| [0001_init.sql](supabase/migrations/0001_init.sql) | `profiles`, `conversations`, `messages` + RLS |
| [0002_contacts.sql](supabase/migrations/0002_contacts.sql) | `contacts` for returning-client detection |
| [0003_stripe_events.sql](supabase/migrations/0003_stripe_events.sql) | webhook idempotency |
| [0004_abandon_stale_conversations.sql](supabase/migrations/0004_abandon_stale_conversations.sql) | sweep for stale conversations |

### Stripe webhooks locally

Stripe cannot reach `localhost`, so use the CLI tunnel. The signing secret it
prints is different from a dashboard endpoint's, and changes each session:

```bash
stripe listen --forward-to localhost:5173/api/stripe-webhook
# copy the whsec_… it prints into STRIPE_WEBHOOK_SECRET
```

Then walk the flow: sign up → onboarding → dashboard → open your `/intake/[slug]`
link in another tab → chat → Finish → back to the dashboard.

## Scripts

| Script | Action |
|---|---|
| `npm run dev` | Vite dev server — front end + `/api/*` |
| `npm run dev:vercel` | `vercel dev` — the real platform, needs a linked project |
| `npm run build` | Type-check + production build |
| `npm run typecheck` | TypeScript check, no emit |

## Environment variables

See [.env.example](.env.example). `VITE_*` vars are public (browser-safe). Everything
else is server-side only and must never reach the client.

## How it is put together

**The server owns the conversation.** `/api/chat` resolves the pro by slug, builds
the system prompt from their config, and persists every message. The browser
never sees the prompt and never writes to the database.

**Extraction is schema-enforced.** `/api/summarize` builds a JSON Schema from the
pro's `fields_to_collect` and uses Structured Outputs, so every field comes back
present — with the visitor's value or `null`, never invented.

**Only signed events change a plan.** Checkout collects payment but proves nothing;
its `success_url` is a URL anyone can type. `/api/stripe-webhook` verifies the
Stripe signature over the raw request bytes and is the sole writer of `plan`.
Events are claimed in `stripe_events` before processing, so Stripe's at-least-once
redelivery cannot re-apply a superseded change.

**Personal data stays server-side.** Visitor answers live in `conversations.summary`
and `contacts`, both under RLS that scopes every read to the owning pro. Database
errors are reported by SQLSTATE and constraint name only — Postgres embeds the
offending values in its messages, which would otherwise put phone numbers and
e-mail addresses in the platform logs. Public endpoints return generic errors and
log the detail instead. Nothing collected from a visitor is ever sent to Stripe.

## Roadmap

1.  ✅ Setup + hello-world function
2.  ✅ First Claude call via `/api/chat`
3.  ✅ Supabase schema + Auth + RLS
4.  ✅ Mobile-first chat UI
5.  ✅ Config-driven conversation loop
6.  ✅ Structured JSON summary + storage
7.  ✅ Pro dashboard (summaries + plan)
8.  ✅ Stripe Checkout (subscription)
9.  ✅ Stripe webhook + edge cases
10. 🚧 **Deploy + polish + portfolio**

## Deploying

1. `vercel link` — link the repo to a Vercel project
2. Set every variable from `.env.example` in the Vercel project settings.
   `STRIPE_WEBHOOK_SECRET` is **not** the local one: create an event destination
   in the Stripe dashboard pointing at `https://<your-domain>/api/stripe-webhook`,
   subscribed to `checkout.session.completed` and the three
   `customer.subscription.*` events, and use the secret it gives you.
3. Set `APP_URL` to the stable production domain. Without it the code falls back
   to `VERCEL_URL`, which changes on every deployment and would send customers
   back to a stale preview after checkout.
4. `vercel --prod`

## License

Demo / portfolio project.
