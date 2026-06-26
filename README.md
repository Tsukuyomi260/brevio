# AI Intake Assistant

> A conversational AI intake platform for service professionals — collects structured client information through a guided chat (OpenAI), with a Free/Pro subscription flow (Stripe).

**Status:** 🚧 In development · Step 1/10 (scaffold) · portfolio demo (Stripe in Test mode).

## What it does

A professional (dentist, lawyer, agent, consultant…) configures an AI assistant, gets a public link `/intake/[slug]`, and shares it with clients. Visitors chat — no signup — and the AI collects the info the pro needs before the appointment. The pro reads a structured summary in their dashboard. Usage above the free quota unlocks via a Stripe subscription.

## Tech stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS (mobile-first)
- **Backend:** Vercel Functions (serverless Node.js)
- **Database / Auth:** Supabase (PostgreSQL + Row Level Security + Auth)
- **AI:** OpenAI API (`gpt-4o-mini`)
- **Payments:** Stripe Checkout + Customer Portal + webhooks

## Local development

Requirements: Node 18+ and npm.

```bash
npm install
cp .env.example .env.local   # then fill in the values

# Front-end only (API calls to /api will 404):
npm run dev                  # http://localhost:5173

# Front-end + serverless functions together (recommended):
npm i -g vercel              # one-time
npm run dev:vercel           # http://localhost:3000  (serves /api/*)
```

Open the app — the home screen pings `/api/hello` and shows the API health status.

## Scripts

| Script | Action |
|---|---|
| `npm run dev` | Vite dev server (front only) |
| `npm run dev:vercel` | `vercel dev` — front + `/api/*` functions |
| `npm run build` | Type-check + production build |
| `npm run typecheck` | TypeScript check, no emit |

## Environment variables

See [.env.example](.env.example). `VITE_*` vars are public (browser-safe). All others are server-side only and must never be exposed to the client.

## Roadmap

1. ✅ **Setup + hello-world function**
2. ⬜ First OpenAI call via `/api/chat`
3. ⬜ Supabase schema + Auth + RLS
4. ⬜ Mobile-first chat UI
5. ⬜ Config-driven conversation loop
6. ⬜ Structured JSON summary + storage
7. ⬜ Pro dashboard (summaries + plan)
8. ⬜ Stripe Checkout (subscription)
9. ⬜ Stripe webhook + edge cases
10. ⬜ Deploy + polish + portfolio

## License

Demo / portfolio project.
