-- 板块资金：独立解锁10积分，12小时内重复查看不重复扣分。
-- 特权实现放在未暴露的独立schema，公开RPC仅为 SECURITY INVOKER 包装。
create schema if not exists sectorflow_private;
revoke all on schema sectorflow_private from public, anon;
grant usage on schema sectorflow_private to authenticated;
alter table public.point_accounts add column if not exists sectorflow_unlock_until timestamptz;
alter table public.point_ledger drop constraint if exists point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check check
 (kind in ('signup','signin','refresh','unlock','refund','analysis','analysis_refund','invite_reward','invite_bonus','admin_grant','admin_revoke','unlock_limitup','unlock_sectorflow'));

create or replace function sectorflow_private.status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); acc public.point_accounts;
begin
 if uid is null then raise exception 'login required' using errcode = '28000'; end if;
 acc := public._points_account(uid);
 return jsonb_build_object('balance',acc.balance,'unlimited',acc.unlimited,
  'unlockUntil',case when acc.sectorflow_unlock_until > now() then acc.sectorflow_unlock_until end);
end; $$;

create or replace function sectorflow_private.unlock()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); acc public.point_accounts; until_time timestamptz;
begin
 if uid is null then raise exception 'login required' using errcode = '28000'; end if;
 -- Locks this user's account before testing expiration and charging, including concurrent calls.
 acc := public._points_account(uid);
 if acc.unlimited then
  return jsonb_build_object('ok',true,'charged',false,'unlimited',true,'balance',acc.balance,'unlockUntil',null);
 end if;
 if acc.sectorflow_unlock_until > now() then
  return jsonb_build_object('ok',true,'charged',false,'balance',acc.balance,'unlockUntil',acc.sectorflow_unlock_until);
 end if;
 if acc.balance < 10 then
  return jsonb_build_object('ok',false,'reason','insufficient','balance',acc.balance);
 end if;
 until_time := now() + interval '12 hours';
 update public.point_accounts set sectorflow_unlock_until = until_time where user_id = uid;
 perform public._points_change(uid,'unlock_sectorflow',-10);
 return jsonb_build_object('ok',true,'charged',true,'balance',acc.balance-10,'unlockUntil',until_time);
end; $$;
revoke all on function sectorflow_private.status(),sectorflow_private.unlock() from public,anon,authenticated;
grant execute on function sectorflow_private.status(),sectorflow_private.unlock() to authenticated;

create or replace function public.points_sectorflow_status()
returns jsonb language sql security invoker set search_path = '' as $$select sectorflow_private.status();$$;
create or replace function public.points_unlock_sectorflow()
returns jsonb language sql security invoker set search_path = '' as $$select sectorflow_private.unlock();$$;
revoke all on function public.points_sectorflow_status(),public.points_unlock_sectorflow() from public,anon,authenticated;
grant execute on function public.points_sectorflow_status(),public.points_unlock_sectorflow() to authenticated;
