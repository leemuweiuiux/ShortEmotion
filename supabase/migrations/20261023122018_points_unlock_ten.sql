-- 题材异动解锁调整为 10 积分；已解锁有效期及不限额规则保持不变。
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
  if acc.balance < 10 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', acc.balance);
  end if;
  v_until := now() + interval '12 hours';
  update public.point_accounts set unlock_until = v_until where user_id = uid;
  perform public._points_change(uid, 'unlock', -10);
  return jsonb_build_object('ok', true, 'charged', true, 'balance', acc.balance - 10, 'unlockUntil', v_until);
end;
$$;


revoke all on function public.points_unlock_anomalies() from public, anon;
grant execute on function public.points_unlock_anomalies() to authenticated;
