-- ShortEmotion 活跃用户（只保留最近 30 天）
-- 在 Supabase → SQL Editor 执行一次。注册用户本身由 Supabase Auth 记录（Authentication → Users），这里只记「哪天来过」。
--
--   daily_active          每人每天一行：看了哪个市场、刷新几次、当天第一次 / 最后一次出现的时间
--   record_activity()     网站用登录用户自己的凭证调用（打开看板、点刷新时），顺手删掉 30 天前的记录
--   activity_summary      注册用户数、今日 / 近 7 天 / 近 30 天活跃人数
--   activity_daily        近 30 天每天的活跃人数、A股 / 台股人数、刷新次数
--
-- 表和视图都不对网站访客开放（没有 RLS 策略、撤销了 anon / authenticated 的权限），只能在 Supabase 后台查看。

create table if not exists public.daily_active (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,                         -- 北京时间的日期
  markets    text[] not null default '{}',          -- 当天看过的市场：cn、tw
  refreshes  integer not null default 0,            -- 当天点「刷新」的次数
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_active_day_idx on public.daily_active (day);

alter table public.daily_active enable row level security;
revoke all on table public.daily_active from anon, authenticated;

create or replace function public.record_activity(p_market text default null, p_refresh boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Shanghai')::date;
  market text := case when p_market in ('cn', 'tw') then p_market end;
begin
  if uid is null then
    return;
  end if;

  insert into public.daily_active as a (user_id, day, markets, refreshes)
  values (uid, today, case when market is null then '{}'::text[] else array[market] end, case when p_refresh then 1 else 0 end)
  on conflict (user_id, day) do update set
    markets   = case when market is null or market = any (a.markets) then a.markets else a.markets || market end,
    refreshes = a.refreshes + case when p_refresh then 1 else 0 end,
    last_seen = now();

  -- 只保留最近 30 天（含今天）
  delete from public.daily_active where day < today - 29;
end;
$$;

revoke all on function public.record_activity(text, boolean) from public, anon;
grant execute on function public.record_activity(text, boolean) to authenticated;

create or replace view public.activity_summary with (security_invoker = true) as
with today as (select (now() at time zone 'Asia/Shanghai')::date as d)
select
  (select count(*) from auth.users)                                                               as registered_users,
  (select count(*) from auth.users, today where (created_at at time zone 'Asia/Shanghai')::date >= today.d - 6) as new_users_7d,
  (select count(distinct user_id) from public.daily_active, today where day = today.d)             as active_today,
  (select count(distinct user_id) from public.daily_active, today where day >= today.d - 6)        as active_7d,
  (select count(distinct user_id) from public.daily_active, today where day >= today.d - 29)       as active_30d;

create or replace view public.activity_daily with (security_invoker = true) as
select
  day,
  count(*)                                   as active_users,
  count(*) filter (where 'cn' = any (markets)) as cn_users,
  count(*) filter (where 'tw' = any (markets)) as tw_users,
  coalesce(sum(refreshes), 0)                as refreshes
from public.daily_active
group by day
order by day desc;

revoke all on table public.activity_summary, public.activity_daily from anon, authenticated;
