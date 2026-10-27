-- 涨停情绪（/limitup）解锁：10 积分，12 小时内有效；与「题材异动」的解锁分开计算、分开扣分。
-- 不限额账号一直解锁、不扣分。流水类型 unlock_limitup（页面显示「解锁涨停情绪」）。
-- 在 Supabase SQL Editor 执行一次。没执行之前，/limitup 显示「积分服务暂时不可用」，不扣分。

alter table public.point_accounts add column if not exists limitup_unlock_until timestamptz;

alter table public.point_ledger drop constraint if exists point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check
  check (kind in ('signup', 'signin', 'refresh', 'unlock', 'refund', 'analysis', 'analysis_refund', 'invite_reward', 'invite_bonus', 'admin_grant', 'admin_revoke', 'unlock_limitup'));

-- 解锁状态（/api/limitup 读取）：余额、是否不限额、涨停情绪解锁到什么时候（已过期返回 null）
create or replace function public.points_limitup_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  return jsonb_build_object(
    'balance', acc.balance,
    'unlimited', acc.unlimited,
    'unlockUntil', case when acc.limitup_unlock_until > now() then acc.limitup_unlock_until end
  );
end;
$$;

-- 解锁：有效期内再调用不扣分；余额不足返回 ok=false
create or replace function public.points_unlock_limitup()
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
  if acc.limitup_unlock_until > now() then
    return jsonb_build_object('ok', true, 'charged', false, 'balance', acc.balance, 'unlockUntil', acc.limitup_unlock_until);
  end if;
  if acc.balance < 10 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', acc.balance);
  end if;
  v_until := now() + interval '12 hours';
  update public.point_accounts set limitup_unlock_until = v_until where user_id = uid;
  perform public._points_change(uid, 'unlock_limitup', -10);
  return jsonb_build_object('ok', true, 'charged', true, 'balance', acc.balance - 10, 'unlockUntil', v_until);
end;
$$;

revoke all on function public.points_limitup_status() from public, anon;
grant execute on function public.points_limitup_status() to authenticated;
revoke all on function public.points_unlock_limitup() from public, anon;
grant execute on function public.points_unlock_limitup() to authenticated;
