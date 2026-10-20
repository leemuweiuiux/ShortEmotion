-- 不限额账号（2026-10-20 与产品确认，方案 A）
--   不限额 = 题材异动一直解锁、手动刷新不扣分；手动刷新仍只在交易时段、且 10 分钟内只触发一次（服务端控制）。
--   流水照样记一笔 0 分的「刷新数据」，方便统计实际用量。
--   只能在 SQL Editor 里打开 / 关闭（页面没有入口）：见文件末尾。
-- 在 20261020_points.sql 之后执行一次。

alter table public.point_accounts add column if not exists unlimited boolean not null default false;

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
    'timezone', tz
  );
end;
$$;

-- 不限额：直接视为已解锁，不扣分也不记流水
create or replace function public.points_unlock_anomalies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  v_until timestamptz;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  if acc.unlimited then
    return jsonb_build_object('ok', true, 'charged', false, 'unlimited', true, 'balance', acc.balance, 'unlockUntil', null);
  end if;
  if acc.unlock_until > now() then
    return jsonb_build_object('ok', true, 'charged', false, 'balance', acc.balance, 'unlockUntil', acc.unlock_until);
  end if;
  if acc.balance < 5 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', acc.balance);
  end if;
  v_until := now() + interval '12 hours';
  update public.point_accounts set unlock_until = v_until where user_id = uid;
  perform public._points_change(uid, 'unlock', -5);
  return jsonb_build_object('ok', true, 'charged', true, 'balance', acc.balance - 5, 'unlockUntil', v_until);
end;
$$;

-- 不限额：记一笔 0 分的刷新（统计用量），不检查余额
create or replace function public.points_charge_refresh()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  cost integer;
  ledger_id bigint;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  cost := case when acc.unlimited then 0 else 5 end;
  if acc.balance < cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', acc.balance);
  end if;
  ledger_id := public._points_change(uid, 'refresh', -cost);
  return jsonb_build_object('ok', true, 'balance', acc.balance - cost, 'charged', cost, 'unlimited', acc.unlimited, 'ledgerId', ledger_id);
end;
$$;

-- 退回：按原来扣了多少退多少（不限额的 0 分记录不需要退）
create or replace function public.points_refund_refresh(p_ledger_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  charged integer;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  select -l.delta into charged from public.point_ledger l
  where l.id = p_ledger_id and l.user_id = uid and l.kind = 'refresh' and l.created_at > now() - interval '5 minutes';
  if charged is null or charged <= 0 or exists (select 1 from public.point_ledger where ref = p_ledger_id and kind = 'refund') then
    return jsonb_build_object('ok', false, 'balance', acc.balance);
  end if;
  perform public._points_change(uid, 'refund', charged, p_ledger_id);
  return jsonb_build_object('ok', true, 'balance', acc.balance + charged);
end;
$$;

revoke all on function public.points_status(text), public.points_unlock_anomalies(), public.points_charge_refresh(), public.points_refund_refresh(bigint) from public, anon;
grant execute on function public.points_status(text), public.points_unlock_anomalies(), public.points_charge_refresh(), public.points_refund_refresh(bigint) to authenticated;

-- ── 打开不限额（账号需要先登录过网站）──
select public._points_account(id) from auth.users where email = '654526275@qq.com';
update public.point_accounts set unlimited = true
where user_id = (select id from auth.users where email = '654526275@qq.com');

-- 查看所有不限额账号：
--   select u.email, a.balance from public.point_accounts a join auth.users u on u.id = a.user_id where a.unlimited;
-- 关闭：
--   update public.point_accounts set unlimited = false where user_id = (select id from auth.users where email = '...');
