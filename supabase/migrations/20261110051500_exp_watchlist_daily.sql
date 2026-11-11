-- Exp only. Each dispatch carries a one-use, short-lived challenge.
create schema if not exists exp_watchlist_jobs;
revoke all on schema exp_watchlist_jobs from public, anon, authenticated;
create table if not exists exp_watchlist_jobs.runs (
  nonce uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('daily', 'probe')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  request_id bigint,
  result jsonb
);
revoke all on exp_watchlist_jobs.runs from public, anon, authenticated;

create or replace function private.dispatch_exp_watchlist(p_mode text default 'daily')
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  v_nonce uuid;
  v_request bigint;
begin
  delete from exp_watchlist_jobs.runs where created_at < now() - interval '30 days';
  insert into exp_watchlist_jobs.runs(mode) values (p_mode) returning nonce into v_nonce;
  select net.http_post(
    url := 'https://awrpzbxdhrwbweskgipj.supabase.co/functions/v1/exp-watchlist-daily',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Watchlist-Run', v_nonce),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  ) into v_request;
  update exp_watchlist_jobs.runs set request_id = v_request where nonce = v_nonce;
  return v_request;
end;
$$;
revoke all on function private.dispatch_exp_watchlist(text) from public, anon, authenticated;

-- SQL functions are invoker-rights. Only the Edge runtime's service role can claim a run.
grant usage on schema exp_watchlist_jobs to service_role;
grant select, update on exp_watchlist_jobs.runs to service_role;
create or replace function public.exp_watchlist_claim_run(p_nonce uuid)
returns text language sql security invoker set search_path = '' as $$
  update exp_watchlist_jobs.runs set claimed_at = now()
  where nonce = p_nonce and claimed_at is null and created_at > now() - interval '3 minutes'
  returning mode;
$$;
create or replace function public.exp_watchlist_finish_run(p_nonce uuid, p_result jsonb)
returns void language sql security invoker set search_path = '' as $$
  update exp_watchlist_jobs.runs set result = p_result
  where nonce = p_nonce and claimed_at is not null and result is null;
$$;
revoke all on function public.exp_watchlist_claim_run(uuid), public.exp_watchlist_finish_run(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.exp_watchlist_claim_run(uuid), public.exp_watchlist_finish_run(uuid,jsonb) to service_role;

-- pg_cron on this project is UTC. The worker checks today's completed index bar before publishing.
select cron.schedule('exp-watchlist-daily', '0 12 * * 1-5', $$select private.dispatch_exp_watchlist('daily')$$);
