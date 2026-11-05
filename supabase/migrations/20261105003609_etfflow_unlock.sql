-- 宽基ETF资金：独立解锁10积分，12小时内重复查看不重复扣分。
-- 特权实现放在未暴露的独立schema，公开RPC仅为 SECURITY INVOKER 包装。
create schema if not exists etfflow_private;
revoke all on schema etfflow_private from public, anon;
grant usage on schema etfflow_private to authenticated;
alter table public.point_accounts add column if not exists etfflow_unlock_until timestamptz;
alter table public.point_ledger drop constraint if exists point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check check
 (kind in ('signup','signin','refresh','unlock','refund','analysis','analysis_refund','invite_reward','invite_bonus','admin_grant','admin_revoke','unlock_limitup','unlock_sectorflow','unlock_etfflow'));

create or replace function etfflow_private.status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); acc public.point_accounts;
begin
 if uid is null then raise exception 'login required' using errcode = '28000'; end if;
 acc := public._points_account(uid);
 return jsonb_build_object('balance',acc.balance,'unlimited',acc.unlimited,
  'unlockUntil',case when acc.etfflow_unlock_until > now() then acc.etfflow_unlock_until end);
end; $$;

create or replace function etfflow_private.unlock()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); acc public.point_accounts; until_time timestamptz;
begin
 if uid is null then raise exception 'login required' using errcode = '28000'; end if;
 -- Locks this user's account before testing expiration and charging, including concurrent calls.
 acc := public._points_account(uid);
 if acc.unlimited then
  return jsonb_build_object('ok',true,'charged',false,'unlimited',true,'balance',acc.balance,'unlockUntil',null);
 end if;
 if acc.etfflow_unlock_until > now() then
  return jsonb_build_object('ok',true,'charged',false,'balance',acc.balance,'unlockUntil',acc.etfflow_unlock_until);
 end if;
 if acc.balance < 10 then
  return jsonb_build_object('ok',false,'reason','insufficient','balance',acc.balance);
 end if;
 until_time := now() + interval '12 hours';
 update public.point_accounts set etfflow_unlock_until = until_time where user_id = uid;
 perform public._points_change(uid,'unlock_etfflow',-10);
 return jsonb_build_object('ok',true,'charged',true,'balance',acc.balance-10,'unlockUntil',until_time);
end; $$;
revoke all on function etfflow_private.status(),etfflow_private.unlock() from public,anon,authenticated;
grant execute on function etfflow_private.status(),etfflow_private.unlock() to authenticated;

create or replace function public.points_etfflow_status()
returns jsonb language sql security invoker set search_path = '' as $$select etfflow_private.status();$$;
create or replace function public.points_unlock_etfflow()
returns jsonb language sql security invoker set search_path = '' as $$select etfflow_private.unlock();$$;
revoke all on function public.points_etfflow_status(),public.points_unlock_etfflow() from public,anon,authenticated;
grant execute on function public.points_etfflow_status(),public.points_unlock_etfflow() to authenticated;
