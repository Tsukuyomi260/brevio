-- Brevio — Contacts table for recurring client detection (Step 6+)
-- Tracks clients who return, indexed by phone/email for quick lookup during intake.

-- Helper: normalize phone (remove spaces, +33 → 0, dashes, dots, parens)
create or replace function public.normalize_phone(txt text)
returns text language sql immutable as $$
  select
    case
      when txt is null or txt = '' then null
      else regexp_replace(
        regexp_replace(
          -- Remove non-digits except leading +
          regexp_replace(txt, '[^+0-9]', '', 'g'),
          -- +33 → 0
          '^\+33', '0'
        ),
        '^0+', '0' -- avoid leading zeros beyond one
      )
    end;
$$;

-- Helper: normalize email (lowercase, trim)
create or replace function public.normalize_email(txt text)
returns text language sql immutable as $$
  select lower(trim(coalesce(txt, '')));
$$;

create table public.contacts (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles(id) on delete cascade,

  -- Normalized identifiers (one per contact, but we allow both)
  phone_normalized    text,
  email_normalized    text,
  full_name           text,

  -- Tracking
  visit_count         int not null default 1,
  last_seen           timestamptz not null default now(),
  last_summary        jsonb, -- The last conversation's summary for context

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Constraints: at least one identifier, unique per profile
  constraint at_least_one_id check (phone_normalized is not null or email_normalized is not null),
  unique (profile_id, phone_normalized),
  unique (profile_id, email_normalized)
);

create index contacts_profile_id_idx on public.contacts(profile_id);
create index contacts_phone_idx on public.contacts(phone_normalized);
create index contacts_email_idx on public.contacts(email_normalized);

-- RLS: a pro reads/writes only their own contacts
alter table public.contacts enable row level security;

create policy contacts_select_own on public.contacts
  for select using (profile_id = auth.uid());

create policy contacts_update_own on public.contacts
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy contacts_insert_own on public.contacts
  for insert with check (profile_id = auth.uid());

-- Trigger: auto-update updated_at
create trigger contacts_updated_at_trg
  before update on public.contacts
  for each row execute function public.set_updated_at();
