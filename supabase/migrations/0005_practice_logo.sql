-- Brevio — practice logo (Step 10)
-- Run in the Supabase SQL editor (or `supabase db push`).

alter table public.profiles
  add column if not exists logo_url text;

comment on column public.profiles.logo_url is
  'Public URL of the practice logo in the `logos` storage bucket. Null until one is uploaded.';

-- ── Storage ──────────────────────────────────────────────────────────────
-- The bucket is public-read because the intake page is anonymous: a visitor
-- has no session, so a signed URL would need the server in the loop for an
-- image. Only the logo lives here — nothing collected from a visitor is ever
-- stored in a publicly readable bucket.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Objects are keyed `<profile_id>/<filename>`, so the first path segment is the
-- owner. Writes are checked against it: a signed-in pro can only touch their own
-- folder, never another practice's logo.

drop policy if exists "logos are publicly readable" on storage.objects;
create policy "logos are publicly readable" on storage.objects
  for select using (bucket_id = 'logos');

drop policy if exists "a pro uploads only their own logo" on storage.objects;
create policy "a pro uploads only their own logo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "a pro replaces only their own logo" on storage.objects;
create policy "a pro replaces only their own logo" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "a pro removes only their own logo" on storage.objects;
create policy "a pro removes only their own logo" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
