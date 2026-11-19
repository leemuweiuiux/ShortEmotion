-- 个股分析改为免费、每人每天（北京时间）最多 10 次（2026-11-19 用户决定）。
-- 新增函数，旧的 points_charge_analysis（扣 10 积分）保留给主站，直到这一版同步到主站。
-- 每次新分析或主动更新记一笔 0 分的 analysis 流水（发布结果仍凭这笔流水，见 analysis_private.publish）；
-- 只计算当天已成功发布的分析，分析失败、保存失败不占次数；不限额账号不受限制。

create or replace function public._analysis_used_today(uid uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.point_ledger l
  join analysis_private.used_analysis_charges u on u.ledger_id = l.id
  where l.user_id = uid
    and l.kind = 'analysis'
    and l.created_at >= ((now() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai');
$$;
revoke all on function public._analysis_used_today(uuid) from public, anon, authenticated;

create or replace function public.points_analysis_quota()
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
  return jsonb_build_object('used', public._analysis_used_today(uid), 'limit', 10, 'unlimited', acc.unlimited, 'balance', acc.balance);
end;
$$;

create or replace function public.points_charge_analysis_quota(p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  used integer;
  ledger_id bigint;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  used := public._analysis_used_today(uid);
  if not acc.unlimited and used >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'used', used, 'limit', 10, 'balance', acc.balance);
  end if;
  ledger_id := public._points_change(uid, 'analysis', 0);
  update public.point_ledger set note = left(nullif(btrim(p_note), ''), 40) where id = ledger_id;
  return jsonb_build_object('ok', true, 'balance', acc.balance, 'charged', 0, 'unlimited', acc.unlimited,
    'ledgerId', ledger_id, 'used', used + 1, 'limit', 10);
end;
$$;

revoke all on function public.points_analysis_quota(), public.points_charge_analysis_quota(text) from public, anon;
grant execute on function public.points_analysis_quota(), public.points_charge_analysis_quota(text) to authenticated;
