-- 关注页题材集中度（2026-11-27）：每只关注股票存一份所属概念，只取一次。
-- null = 还没取；[] = 取过但没有可用题材。用户只能写自己那几行的 concepts 栏位。
alter table public.exp_watchlist_stocks add column if not exists concepts text[]
  check (concepts is null or cardinality(concepts) <= 80);
grant insert (code, name, slot, concepts) on public.exp_watchlist_stocks to authenticated;
grant update (concepts) on public.exp_watchlist_stocks to authenticated;
drop policy if exists "exp watchlist update own concepts" on public.exp_watchlist_stocks;
create policy "exp watchlist update own concepts" on public.exp_watchlist_stocks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
