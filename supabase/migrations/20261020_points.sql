-- 积分（2026-10-20 与产品确认）
--   获取：注册赠送 +50（已注册的用户第一次打开时补发）、每日签到 +10（按用户所在时区的 00:00 换日）
--   消耗：手动刷新数据 −5、解锁当日题材异动 −5（解锁后 12 小时内有效）
-- 余额与流水只记类型（注册赠送 / 签到 / 刷新 / 解锁异动 / 退回），不记看了哪个题材；流水永久保留，方便以后对账。
-- 表只能通过下面的函数读写：函数用登录用户自己的凭证调用（auth.uid()），不需要 secret key。
-- 在 Supabase → SQL Editor 执行一次。

create table if not exists public.point_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  timezone text,                -- 第一次签到时记下的时区，之后按它换日（避免改时区重复签到）
  last_signin_day date,         -- 最近一次签到是哪一天（按上面的时区）
  unlock_until timestamptz,     -- 题材异动解锁到什么时候
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.point_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('signup', 'signin', 'refresh', 'unlock', 'refund')),
  delta integer not null,
  balance_after integer not null,
  ref bigint,                   -- 退回时指向被退回的那一笔
  created_at timestamptz not null default now()
);
create index if not exists point_ledger_user_id_idx on public.point_ledger (user_id, id desc);

alter table public.point_accounts enable row level security;
alter table public.point_ledger enable row level security;
revoke all on table public.point_accounts, public.point_ledger from anon, authenticated;

-- 没有账户就开户并赠送 50 分；返回加锁后的账户行（同一用户的并发请求排队执行）。
create or replace function public._points_account(uid uuid)
returns public.point_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc public.point_accounts;
begin
  insert into public.point_accounts (user_id, balance) values (uid, 50) on conflict (user_id) do nothing;
  if found then
    insert into public.point_ledger (user_id, kind, delta, balance_after) values (uid, 'signup', 50, 50);
  end if;
  select * into acc from public.point_accounts where user_id = uid for update;
  return acc;
end;
$$;
revoke all on function public._points_account(uuid) from public, anon, authenticated;

create or replace function public._points_change(uid uuid, p_kind text, p_delta integer, p_ref bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_balance integer;
  ledger_id bigint;
begin
  update public.point_accounts set balance = balance + p_delta, updated_at = now() where user_id = uid returning balance into new_balance;
  insert into public.point_ledger (user_id, kind, delta, balance_after, ref) values (uid, p_kind, p_delta, new_balance, p_ref) returning id into ledger_id;
  return ledger_id;
end;
$$;
revoke all on function public._points_change(uuid, text, integer, bigint) from public, anon, authenticated;

-- 余额、今天是否已签到、题材异动解锁到何时
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
    'signedToday', acc.last_signin_day is not null and acc.last_signin_day = (now() at time zone tz)::date,
    'unlockUntil', case when acc.unlock_until > now() then acc.unlock_until end,
    'timezone', tz
  );
end;
$$;

-- 每日签到 +10：按用户第一次签到时的时区换日
create or replace function public.points_signin(p_timezone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  tz text;
  today date;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  tz := coalesce(acc.timezone, case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then p_timezone end, 'Asia/Shanghai');
  today := (now() at time zone tz)::date;
  if acc.last_signin_day = today then
    return jsonb_build_object('ok', false, 'reason', 'already', 'balance', acc.balance);
  end if;
  update public.point_accounts set timezone = tz, last_signin_day = today where user_id = uid;
  perform public._points_change(uid, 'signin', 10);
  return jsonb_build_object('ok', true, 'delta', 10, 'balance', acc.balance + 10);
end;
$$;

-- 解锁当日题材异动 −5，12 小时内有效；有效期内再调用不扣分
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

-- 手动刷新 −5：扣分成功后服务器才去触发更新；触发失败时用 points_refund_refresh 退回
create or replace function public.points_charge_refresh()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  ledger_id bigint;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  if acc.balance < 5 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', acc.balance);
  end if;
  ledger_id := public._points_change(uid, 'refresh', -5);
  return jsonb_build_object('ok', true, 'balance', acc.balance - 5, 'ledgerId', ledger_id);
end;
$$;

-- 退回刷新扣的分：只能退自己 5 分钟内的刷新扣分，每笔只退一次
create or replace function public.points_refund_refresh(p_ledger_id bigint)
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
  if not exists (
    select 1 from public.point_ledger
    where id = p_ledger_id and user_id = uid and kind = 'refresh' and created_at > now() - interval '5 minutes'
  ) or exists (select 1 from public.point_ledger where ref = p_ledger_id and kind = 'refund') then
    return jsonb_build_object('ok', false, 'balance', acc.balance);
  end if;
  perform public._points_change(uid, 'refund', 5, p_ledger_id);
  return jsonb_build_object('ok', true, 'balance', acc.balance + 5);
end;
$$;

-- 积分流水：最新在前，每次最多 50 笔；p_before 传上一页最后一笔的 id 继续往下翻
create or replace function public.points_history(p_limit integer default 20, p_before bigint default null)
returns table (id bigint, kind text, delta integer, balance_after integer, created_at timestamptz)
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
    select l.id, l.kind, l.delta, l.balance_after, l.created_at
    from public.point_ledger l
    where l.user_id = uid and (p_before is null or l.id < p_before)
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.points_status(text), public.points_signin(text), public.points_unlock_anomalies(),
  public.points_charge_refresh(), public.points_refund_refresh(bigint), public.points_history(integer, bigint) from public, anon;
grant execute on function public.points_status(text), public.points_signin(text), public.points_unlock_anomalies(),
  public.points_charge_refresh(), public.points_refund_refresh(bigint), public.points_history(integer, bigint) to authenticated;

-- 运营查看（只在 SQL Editor 用，不开放给页面）
create or replace view public.points_overview with (security_invoker = true) as
select
  (select count(*) from public.point_accounts)                                                     as accounts,
  (select coalesce(sum(balance), 0) from public.point_accounts)                                     as total_balance,
  (select count(*) from public.point_ledger where kind = 'signin' and created_at > now() - interval '1 day')  as signins_24h,
  (select count(*) from public.point_ledger where kind = 'refresh' and created_at > now() - interval '1 day') as refreshes_24h,
  (select count(*) from public.point_ledger where kind = 'unlock' and created_at > now() - interval '1 day')  as unlocks_24h;
revoke all on table public.points_overview from anon, authenticated;
