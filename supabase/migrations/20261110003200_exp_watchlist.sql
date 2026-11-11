-- Separate Exp records in the shared database.
create table if not exists public.exp_watchlist_stocks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}\.(SH|SZ|BJ)$'),
  name text not null check (char_length(name) between 1 and 60),
  slot smallint not null check (slot between 1 and 10),
  added_at timestamptz not null default now(),
  primary key (user_id, code),
  unique (user_id, slot)
);
alter table public.exp_watchlist_stocks enable row level security;
revoke all on public.exp_watchlist_stocks from anon, authenticated;
grant select, delete on public.exp_watchlist_stocks to authenticated;
grant insert (code, name, slot) on public.exp_watchlist_stocks to authenticated;
grant select on public.exp_watchlist_stocks to service_role;
create policy "exp watchlist select own" on public.exp_watchlist_stocks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "exp watchlist insert own" on public.exp_watchlist_stocks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "exp watchlist delete own" on public.exp_watchlist_stocks for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.exp_watchlist_market (
  code text primary key,
  data_day date not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.exp_watchlist_market enable row level security;
revoke all on public.exp_watchlist_market from anon, authenticated;
grant select, insert, update on public.exp_watchlist_market to service_role;

create table if not exists public.exp_watchlist_forecasts (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_day date not null,
  picks jsonb not null,
  published_at timestamptz not null default now(),
  primary key (user_id, source_day)
);
alter table public.exp_watchlist_forecasts enable row level security;
revoke all on public.exp_watchlist_forecasts from anon, authenticated;
grant select on public.exp_watchlist_forecasts to authenticated;
grant select, insert on public.exp_watchlist_forecasts to service_role;
create policy "exp forecasts select own" on public.exp_watchlist_forecasts for select to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.exp_watchlist_outcomes (
  user_id uuid not null,
  source_day date not null,
  direction text not null check (direction in ('up', 'down')),
  result jsonb not null,
  primary key (user_id, source_day, direction),
  foreign key (user_id, source_day) references public.exp_watchlist_forecasts(user_id, source_day) on delete cascade
);
alter table public.exp_watchlist_outcomes enable row level security;
revoke all on public.exp_watchlist_outcomes from anon, authenticated;
grant select on public.exp_watchlist_outcomes to authenticated;
grant select, insert on public.exp_watchlist_outcomes to service_role;
create policy "exp outcomes select own" on public.exp_watchlist_outcomes for select to authenticated
  using ((select auth.uid()) = user_id);
