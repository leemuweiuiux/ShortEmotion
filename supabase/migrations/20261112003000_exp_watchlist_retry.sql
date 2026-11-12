-- Watchlist daily job: shared per-code cache, cached quotes for newly added stocks, and retry windows.
alter table public.exp_watchlist_market add column if not exists quote jsonb;
grant select (code, data_day, quote) on public.exp_watchlist_market to authenticated;
drop policy if exists "exp market quotes readable" on public.exp_watchlist_market;
create policy "exp market quotes readable" on public.exp_watchlist_market for select to authenticated using (true);

-- pg_cron is UTC. Evening: 20:05–23:50 Beijing every 15 min (the last two runs publish what they have).
-- Morning catch-up: 08:05–08:50 Beijing for the previous session, always before the next open.
-- Runs are idempotent: finished users and fresh stocks are skipped, so extra runs cost almost nothing.
select cron.unschedule(jobid) from cron.job where jobname in ('exp-watchlist-daily', 'exp-watchlist-evening', 'exp-watchlist-morning');
select cron.schedule('exp-watchlist-evening', '5-50/15 12-15 * * 1-5', $$select private.dispatch_exp_watchlist('daily')$$);
select cron.schedule('exp-watchlist-morning', '5-50/15 0 * * 1-6', $$select private.dispatch_exp_watchlist('daily')$$);

-- Admin: 关注 usage and daily-job health. Counts only; no emails or per-user pools leave the database.
create or replace function public.admin_watchlist()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t timestamptz := public._sh_day_start(0); w timestamptz := public._sh_day_start(6);
  since date := (now() at time zone 'Asia/Shanghai')::date - 30;
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pool', (select jsonb_build_object('users', count(distinct user_id), 'stocks', count(*), 'codes', count(distinct code),
      'fullUsers', (select count(*) from (select 1 from public.exp_watchlist_stocks group by user_id having count(*) >= 10) f),
      'addedToday', count(*) filter (where added_at >= t), 'added7d', count(*) filter (where added_at >= w),
      'usersAdded7d', count(distinct user_id) filter (where added_at >= w)) from public.exp_watchlist_stocks),
    'top', coalesce((select jsonb_agg(r) from (select code, min(name) as name, count(*) as followers
      from public.exp_watchlist_stocks group by code order by count(*) desc, code limit 8) r), '[]'::jsonb),
    'forecasts', (select jsonb_build_object('latestDay', max(source_day),
      'latestUsers', count(*) filter (where source_day = (select max(source_day) from public.exp_watchlist_forecasts)),
      'users7d', count(distinct user_id) filter (where published_at >= w),
      'partialLatest', count(*) filter (where source_day = (select max(source_day) from public.exp_watchlist_forecasts)
        and jsonb_array_length(coalesce(picks->'daily'->'missing', '[]'::jsonb)) > 0))
      from public.exp_watchlist_forecasts),
    'hits', (select jsonb_build_object('since', since,
      'upBeat', count(*) filter (where direction = 'up' and result->>'status' = 'beat'),
      'upMiss', count(*) filter (where direction = 'up' and result->>'status' = 'miss'),
      'downBeat', count(*) filter (where direction = 'down' and result->>'status' = 'beat'),
      'downMiss', count(*) filter (where direction = 'down' and result->>'status' = 'miss'))
      from public.exp_watchlist_outcomes where source_day >= since),
    'runs', coalesce((select jsonb_agg(to_jsonb(r) - 'ts' order by r.ts desc) from (
      select created_at as ts, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as at, mode,
        coalesce(result->>'state', case when claimed_at is null then 'unclaimed' else 'running' end) as state,
        result->>'target' as target, result->>'code' as code,
        (result->>'fetched')::int as fetched, (result->>'failed')::int as failed, (result->>'deferred')::int as deferred,
        (result->>'forecasts')::int as forecasts, (result->>'replaced')::int as replaced, (result->>'settled')::int as settled
      from exp_watchlist_jobs.runs order by created_at desc limit 12) r), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_watchlist() from public, anon;
grant execute on function public.admin_watchlist() to authenticated;
