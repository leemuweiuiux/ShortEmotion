-- 活跃记录简化：只记「哪天来过」，不再记看了哪个市场、刷新几次（2026-10-15 用户决定）。
-- 在 Supabase → SQL Editor 执行一次（在 20261015_daily_active.sql 之后）。

drop view if exists public.activity_daily;
drop view if exists public.activity_summary;
drop function if exists public.record_activity(text, boolean);

alter table public.daily_active drop column if exists markets;
alter table public.daily_active drop column if exists refreshes;

create or replace function public.record_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if uid is null then
    return;
  end if;
  insert into public.daily_active as a (user_id, day)
  values (uid, today)
  on conflict (user_id, day) do update set last_seen = now();
  -- 只保留最近 30 天（含今天）
  delete from public.daily_active where day < today - 29;
end;
$$;

revoke all on function public.record_activity() from public, anon;
grant execute on function public.record_activity() to authenticated;

create view public.activity_summary with (security_invoker = true) as
with today as (select (now() at time zone 'Asia/Shanghai')::date as d)
select
  (select count(*) from auth.users)                                                                            as registered_users,
  (select count(*) from auth.users, today where (created_at at time zone 'Asia/Shanghai')::date >= today.d - 6) as new_users_7d,
  (select count(*) from public.daily_active, today where day = today.d)                                         as active_today,
  (select count(distinct user_id) from public.daily_active, today where day >= today.d - 6)                     as active_7d,
  (select count(distinct user_id) from public.daily_active, today where day >= today.d - 29)                    as active_30d;

create view public.activity_daily with (security_invoker = true) as
select day, count(*) as active_users
from public.daily_active
group by day
order by day desc;

revoke all on table public.activity_summary, public.activity_daily from anon, authenticated;
