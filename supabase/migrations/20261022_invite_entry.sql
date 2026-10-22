-- 登录后补填邀请码（2026-10-22 与产品确认）
--   注册当天忘了填邀请码的新用户，在首页 / 个人页面的积分卡（签到的位置）看到「填写邀请码」。
--   只在同时符合时显示：注册 1 天内、还没签到过、还没绑定邀请、不是不限额账号（与 invite_redeem 的规则一致）。
--   绑定照旧用 invite_redeem；之后第一次签到时双方各 +50。
-- 只替换 points_status（多回传 inviteEligible），不动任何数据。在 20261021c_invites.sql 之后于 Supabase → SQL Editor 执行一次。

create or replace function public.points_status(p_timezone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  tz text;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  tz := coalesce(acc.timezone, case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then p_timezone end, 'Asia/Shanghai');
  return jsonb_build_object(
    'balance', acc.balance,
    'unlimited', acc.unlimited,
    'signedToday', acc.last_signin_day is not null and acc.last_signin_day = (now() at time zone tz)::date,
    'unlockUntil', case when acc.unlock_until > now() then acc.unlock_until end,
    'timezone', tz,
    'invitePending', exists (select 1 from public.invites where invitee_id = uid and rewarded_at is null),
    'inviteEligible', not acc.unlimited
      and not exists (select 1 from public.invites where invitee_id = uid)
      and not exists (select 1 from public.point_ledger where user_id = uid and kind = 'signin')
      and exists (select 1 from auth.users where id = uid and created_at >= now() - interval '1 day')
  );
end;
$$;

revoke all on function public.points_status(text) from public, anon;
grant execute on function public.points_status(text) to authenticated;
