-- Brevio — abandoned conversations (Step 10)
-- Run in the Supabase SQL editor (or `supabase db push`).

-- `conversations.status` has always allowed 'abandoned', but nothing ever wrote
-- it: a visitor who closes the tab mid-chat leaves the row 'in_progress'
-- forever. The dashboard therefore counted them as pending indefinitely and the
-- Abandoned tile was permanently zero.
--
-- A conversation is considered abandoned when it is still in_progress, has no
-- summary, and has seen no message for a while. Idle time is measured from the
-- last message rather than from started_at, so a slow but live conversation is
-- never cut off mid-flow.

create or replace function public.abandon_stale_conversations(idle interval default '3 hours')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  with stale as (
    select c.id
    from public.conversations c
    where c.status = 'in_progress'
      and c.summary is null
      and coalesce(
            (select max(m.created_at) from public.messages m where m.conversation_id = c.id),
            c.started_at
          ) < now() - idle
  )
  update public.conversations c
     set status = 'abandoned'
    from stale
   where c.id = stale.id;

  get diagnostics touched = row_count;
  return touched;
end;
$$;

comment on function public.abandon_stale_conversations(interval) is
  'Marks in_progress conversations idle for longer than `idle` as abandoned. Returns the number of rows changed.';

-- Only the server may run this: it writes conversations, which no browser is
-- ever allowed to do. Revoke the defaults, then grant to service_role alone.
revoke all on function public.abandon_stale_conversations(interval) from public, anon, authenticated;
grant execute on function public.abandon_stale_conversations(interval) to service_role;

-- Schedule it hourly when pg_cron is available. Wrapped so that a project
-- without the extension still gets the function — /api/cron/abandon can drive
-- it instead, and the migration must not fail over an optional scheduler.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('brevio-abandon-stale')
  where exists (select 1 from cron.job where jobname = 'brevio-abandon-stale');

  perform cron.schedule(
    'brevio-abandon-stale',
    '7 * * * *',
    $cron$ select public.abandon_stale_conversations(); $cron$
  );
  raise notice 'pg_cron: brevio-abandon-stale scheduled hourly';
exception
  when others then
    raise notice 'pg_cron unavailable (%), rely on /api/cron/abandon instead', sqlerrm;
end;
$$;
