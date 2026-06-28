-- Brevio — initial schema (Step 3)
-- Run in the Supabase SQL editor (or `supabase db push`).
-- Tables: profiles, conversations, messages. RLS on all.

create extension if not exists "pgcrypto";

-- ── helpers ──────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.slugify(txt text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Generate a slug unique across profiles, e.g. "cabinet-dupont", "cabinet-dupont-2".
create or replace function public.gen_unique_slug(base text)
returns text language plpgsql as $$
declare
  s text := nullif(public.slugify(base), '');
  candidate text;
  n int := 1;
begin
  if s is null then s := 'pro'; end if;
  candidate := s;
  while exists (select 1 from public.profiles where slug = candidate) loop
    n := n + 1;
    candidate := s || '-' || n;
  end loop;
  return candidate;
end;
$$;

-- ── profiles ─────────────────────────────────────────────────────────────
-- Extends auth.users with the pro's business info + subscription state.

create table public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null,
  business_name          text not null,
  profession             text not null,
  slug                   text unique not null,
  intake_config          jsonb not null default '{}'::jsonb,
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  subscription_status    text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Auto-fill slug from business_name when not provided.
create or replace function public.profiles_set_slug()
returns trigger language plpgsql as $$
begin
  if new.slug is null or trim(new.slug) = '' then
    new.slug := public.gen_unique_slug(new.business_name);
  end if;
  return new;
end;
$$;

create trigger profiles_set_slug_trg
  before insert on public.profiles
  for each row execute function public.profiles_set_slug();

create trigger profiles_updated_at_trg
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── conversations ────────────────────────────────────────────────────────
-- One visitor session against a pro's assistant.

create table public.conversations (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'in_progress'
               check (status in ('in_progress', 'completed', 'abandoned')),
  summary      jsonb,
  started_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index conversations_profile_id_idx on public.conversations(profile_id);
create index conversations_started_at_idx on public.conversations(started_at);

-- ── messages ─────────────────────────────────────────────────────────────

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages(conversation_id);

-- ── Row Level Security ───────────────────────────────────────────────────
-- profiles.id == auth.users.id, so profile_id = auth.uid() identifies the owner.
-- Conversations/messages have NO write policies on purpose: only the server
-- (service-role key, which bypasses RLS) writes them. Visitors never touch them.

alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- profiles: a pro reads/creates/updates only their own row.
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- conversations: a pro reads only their own conversations.
create policy conversations_select_own on public.conversations
  for select using (profile_id = auth.uid());

-- messages: a pro reads messages of their own conversations.
create policy messages_select_own on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.profile_id = auth.uid()
    )
  );

-- NOTE (Step 4): public read of limited profile fields for /intake/[slug]
-- will be exposed via a SECURITY DEFINER RPC or a restricted view — added
-- when the public intake page is built. Not exposed here.
