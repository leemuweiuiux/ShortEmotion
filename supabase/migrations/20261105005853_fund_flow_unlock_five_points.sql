-- 资金流向/板块资金与宽基ETF统一5积分，保留12小时有效期和既有解锁。

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
 if acc.balance < 5 then
  return jsonb_build_object('ok',false,'reason','insufficient','balance',acc.balance);
 end if;
 until_time := now() + interval '12 hours';
 update public.point_accounts set sectorflow_unlock_until = until_time where user_id = uid;
 perform public._points_change(uid,'unlock_sectorflow',-5);
 return jsonb_build_object('ok',true,'charged',true,'balance',acc.balance-5,'unlockUntil',until_time);
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
 if acc.balance < 5 then
  return jsonb_build_object('ok',false,'reason','insufficient','balance',acc.balance);
 end if;
 until_time := now() + interval '12 hours';
 update public.point_accounts set etfflow_unlock_until = until_time where user_id = uid;
 perform public._points_change(uid,'unlock_etfflow',-5);
 return jsonb_build_object('ok',true,'charged',true,'balance',acc.balance-5,'unlockUntil',until_time);
end; $$;
