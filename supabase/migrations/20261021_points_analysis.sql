-- 个股技术分析扣分（2026-10-20 与产品确认）
--   每次发起分析 −10（同一支股票重看也扣）；不限额账号记 0 分。
--   服务器先认出股票再扣分（认不出不扣）；扣分后分析失败，用 points_refund_analysis 退回。
--   流水多一栏 note，记分析的股票（例如「样本电子 603936.SH」），积分流水页显示。
-- 在 20261020_points.sql、20261020b_points_unlimited.sql 之后，于 Supabase → SQL Editor 执行一次。

alter table public.point_ledger add column if not exists note text;
alter table public.point_ledger drop constraint if exists point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check
  check (kind in ('signup', 'signin', 'refresh', 'unlock', 'refund', 'analysis', 'analysis_refund'));

-- 个股分析 −10：余额不足时不扣；返回这一笔的 id（失败退回用）
create or replace function public.points_charge_analysis(p_note text default null)
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
  cost := case when acc.unlimited then 0 else 10 end;
  if acc.balance < cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', acc.balance);
  end if;
  ledger_id := public._points_change(uid, 'analysis', -cost);
  update public.point_ledger set note = left(nullif(btrim(p_note), ''), 40) where id = ledger_id;
  return jsonb_build_object('ok', true, 'balance', acc.balance - cost, 'charged', cost, 'unlimited', acc.unlimited, 'ledgerId', ledger_id);
end;
$$;

-- 分析失败退回：只能退自己 10 分钟内的分析扣分，每笔只退一次，扣多少退多少（0 分的不需要退）
create or replace function public.points_refund_analysis(p_ledger_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  charged integer;
  v_note text;
  refund_id bigint;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  select -l.delta, l.note into charged, v_note from public.point_ledger l
  where l.id = p_ledger_id and l.user_id = uid and l.kind = 'analysis' and l.created_at > now() - interval '10 minutes';
  if charged is null or charged <= 0 or exists (select 1 from public.point_ledger where ref = p_ledger_id and kind = 'analysis_refund') then
    return jsonb_build_object('ok', false, 'balance', acc.balance);
  end if;
  refund_id := public._points_change(uid, 'analysis_refund', charged, p_ledger_id);
  update public.point_ledger set note = v_note where id = refund_id;
  return jsonb_build_object('ok', true, 'balance', acc.balance + charged);
end;
$$;

-- 积分流水多返回 note（返回栏位变了，要先删掉旧函数）
drop function if exists public.points_history(integer, bigint);
create function public.points_history(p_limit integer default 20, p_before bigint default null)
returns table (id bigint, kind text, delta integer, balance_after integer, note text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  perform public._points_account(uid);
  return query
    select l.id, l.kind, l.delta, l.balance_after, l.note, l.created_at
    from public.point_ledger l
    where l.user_id = uid and (p_before is null or l.id < p_before)
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.points_charge_analysis(text), public.points_refund_analysis(bigint), public.points_history(integer, bigint) from public, anon;
grant execute on function public.points_charge_analysis(text), public.points_refund_analysis(bigint), public.points_history(integer, bigint) to authenticated;

-- 运营查看：加上近 24 小时的分析次数
create or replace view public.points_overview with (security_invoker = true) as
select
  (select count(*) from public.point_accounts)                                                     as accounts,
  (select coalesce(sum(balance), 0) from public.point_accounts)                                     as total_balance,
  (select count(*) from public.point_ledger where kind = 'signin' and created_at > now() - interval '1 day')  as signins_24h,
  (select count(*) from public.point_ledger where kind = 'refresh' and created_at > now() - interval '1 day') as refreshes_24h,
  (select count(*) from public.point_ledger where kind = 'unlock' and created_at > now() - interval '1 day')  as unlocks_24h,
  (select count(*) from public.point_ledger where kind = 'analysis' and created_at > now() - interval '1 day') as analyses_24h;
revoke all on table public.points_overview from anon, authenticated;
