-- 签到日历（/account/signin）：当前用户签到过的日子（北京时间）与当天签到获得的积分，最新在前。
-- 页面用来算连签、月历与签到成就；连签只做展示，不额外加积分。
-- 没执行这个文件时，api/_lib/signin-calendar.js 会退回翻积分流水（最多 400 笔）。
-- 在 Supabase SQL Editor 执行一次即可。

create or replace function public.points_signin_days(p_limit integer default 400)
returns table (day date, points integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  return query
    select (l.created_at at time zone 'Asia/Shanghai')::date as day, sum(l.delta)::integer as points
    from public.point_ledger l
    where l.user_id = uid and l.kind = 'signin'
    group by 1
    order by 1 desc
    limit least(greatest(coalesce(p_limit, 400), 1), 1000);
end;
$$;

revoke all on function public.points_signin_days(integer) from public, anon;
grant execute on function public.points_signin_days(integer) to authenticated;
