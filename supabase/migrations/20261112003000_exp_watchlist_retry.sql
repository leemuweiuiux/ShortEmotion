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
