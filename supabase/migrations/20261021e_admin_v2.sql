-- 管理后台第二版（2026-10-21 与产品确认）
--   积分发放：送出前先确认对方（打码邮箱 + 注册日期）；发放后 10 分钟内可撤销最近一笔（对方已用掉一部分时不能撤销）。
--   积分列表：每笔带匿名用户代号（U-XXXXXX：同一个人固定、看不出是谁），可按代号筛选。
--   总览：加积分余额分布、近 7 日消耗人数与人均消耗、近 7 日个股分析人数；带上统计时间；不再估算数据成本。
--   上限只在这里定义一次（_admin_limits），接口与页面都从数据库读取。
-- 在 20261021d_admin.sql 之后，于 Supabase → SQL Editor 执行一次。

-- 流水：平台发放撤销（ref 指向被撤销的那笔发放）
alter table public.point_ledger drop constraint if exists point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check
  check (kind in ('signup', 'signin', 'refresh', 'unlock', 'refund', 'analysis', 'analysis_refund', 'invite_reward', 'invite_bonus', 'admin_grant', 'admin_revoke'));

-- 积分发放的上限（唯一定义处）
create or replace function public._admin_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('maxAmount', 1000, 'dailyLimit', 50, 'undoMinutes', 10);
$$;

-- 匿名用户代号：同一个人固定，看不出是谁
create or replace function public._user_code(uid uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'U-' || upper(left(md5(uid::text), 6));
$$;

-- 打码邮箱：前 2 个字符 + *** + @域名
create or replace function public._mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when position('@' in coalesce(p_email, '')) > 1
    then left(split_part(p_email, '@', 1), 2) || '***@' || split_part(p_email, '@', 2)
    else '***' end;
$$;

revoke all on function public._admin_limits(), public._user_code(uuid), public._mask_email(text) from public, anon, authenticated;

-- 总览：只有统计数字
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today_start timestamptz := public._sh_day_start(0);
  week_start timestamptz := public._sh_day_start(6);
  today_day date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'generatedAt', now(),
    'limits', public._admin_limits(),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'newToday', (select count(*) from auth.users where created_at >= today_start),
      'new7d', (select count(*) from auth.users where created_at >= week_start),
      'activeToday', (select count(*) from public.daily_active where day = today_day),
      'active7d', (select count(distinct user_id) from public.daily_active where day >= today_day - 6)
    ),
    'points', jsonb_build_object(
      'circulating', (select coalesce(sum(balance), 0) from public.point_accounts),
      'accounts', (select count(*) from public.point_accounts),
      'today', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'issued', issued, 'spent', spent, 'count', n) order by kind)
        from (select kind, sum(greatest(delta, 0)) as issued, sum(least(delta, 0)) as spent, count(*) as n
              from public.point_ledger where created_at >= today_start group by kind) t), '[]'::jsonb),
      'week', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'issued', issued, 'spent', spent, 'count', n) order by kind)
        from (select kind, sum(greatest(delta, 0)) as issued, sum(least(delta, 0)) as spent, count(*) as n
              from public.point_ledger where created_at >= week_start group by kind) t), '[]'::jsonb)
    ),
    -- 付费相关：余额分布（不含不限额账号）、近 7 日有消耗的人数与人均消耗（只算刷新、解锁、个股分析，不含撤销）
    'balances', (select jsonb_build_object(
        'accounts', count(*),
        'lt10', count(*) filter (where balance < 10),
        'b10to49', count(*) filter (where balance between 10 and 49),
        'b50to99', count(*) filter (where balance between 50 and 99),
        'gte100', count(*) filter (where balance >= 100))
      from public.point_accounts where not unlimited),
    'spend7d', (select jsonb_build_object('users', count(distinct user_id), 'points', coalesce(-sum(delta), 0))
      from public.point_ledger where created_at >= week_start and delta < 0 and kind in ('refresh', 'unlock', 'analysis')),
    'invites', jsonb_build_object(
      'bound', (select count(*) from public.invites),
      'rewarded', (select count(*) from public.invites where rewarded_at is not null)
    ),
    'analyses', jsonb_build_object(
      'today', (select count(*) filter (where kind = 'analysis') - count(*) filter (where kind = 'analysis_refund')
                from public.point_ledger where created_at >= today_start and kind in ('analysis', 'analysis_refund')),
      'week', (select count(*) filter (where kind = 'analysis') - count(*) filter (where kind = 'analysis_refund')
               from public.point_ledger where created_at >= week_start and kind in ('analysis', 'analysis_refund')),
      'users7d', (select count(distinct user_id) from public.point_ledger where created_at >= week_start and kind = 'analysis')
    ),
    'grants', jsonb_build_object(
      'myToday', (select count(*) from public.point_ledger where kind = 'admin_grant' and actor = uid and created_at >= today_start)
    )
  );
end;
$$;

-- 积分列表：时间、类型、变动、匿名用户代号；可按代号筛选（不返回邮箱、余额、备注）
drop function if exists public.admin_ledger(text, date, date, bigint, integer);
create or replace function public.admin_ledger(p_kind text default null, p_from date default null, p_to date default null, p_before bigint default null, p_limit integer default 50, p_user text default null)
returns table (id bigint, kind text, delta integer, created_at timestamptz, user_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select l.id, l.kind, l.delta, l.created_at, public._user_code(l.user_id)
    from public.point_ledger l
    where (p_kind is null or l.kind = p_kind)
      and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Shanghai'))
      and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Shanghai'))
      and (p_before is null or l.id < p_before)
      and (p_user is null or public._user_code(l.user_id) = upper(p_user))
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- 发放前确认对方：打码邮箱与注册日期（找不到返回 found=false）
create or replace function public.admin_lookup(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user record;
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id, email, created_at into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_user.id is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'masked', public._mask_email(v_user.email), 'registeredAt', v_user.created_at, 'userCode', public._user_code(v_user.id));
end;
$$;

-- 积分发放：上限读 _admin_limits；返回这一笔的 id（撤销用）
create or replace function public.admin_grant(p_email text, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim jsonb := public._admin_limits();
  v_label text;
  v_today integer;
  v_target uuid;
  v_email text;
  ledger_id bigint;
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_label := case p_reason when 'recharge' then '积分充值' when 'campaign' then '活动奖励' end;
  if v_label is null then return jsonb_build_object('ok', false, 'reason', 'bad_reason', 'limits', lim); end if;
  if p_amount is null or p_amount < 1 or p_amount > (lim ->> 'maxAmount')::integer then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount', 'limits', lim);
  end if;
  perform pg_advisory_xact_lock(hashtext('admin_grant:' || uid::text));
  select count(*) into v_today from public.point_ledger where kind = 'admin_grant' and actor = uid and created_at >= public._sh_day_start(0);
  if v_today >= (lim ->> 'dailyLimit')::integer then return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'myToday', v_today, 'limits', lim); end if;
  select id, email into v_target, v_email from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_target is null then return jsonb_build_object('ok', false, 'reason', 'not_found', 'limits', lim); end if;
  perform public._points_account(v_target);
  ledger_id := public._points_change(v_target, 'admin_grant', p_amount);
  update public.point_ledger set note = v_label, actor = uid where id = ledger_id;
  return jsonb_build_object('ok', true, 'ledgerId', ledger_id, 'amount', p_amount, 'reasonLabel', v_label, 'masked', public._mask_email(v_email),
    'myToday', v_today + 1, 'undoUntil', now() + make_interval(mins => (lim ->> 'undoMinutes')::integer), 'limits', lim);
end;
$$;

-- 撤销自己 10 分钟内的一笔发放：记一笔「平台发放撤销」扣回；对方余额不够（已用掉一部分）时不能撤销
create or replace function public.admin_undo(p_ledger_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim jsonb := public._admin_limits();
  v_row public.point_ledger;
  acc public.point_accounts;
  ledger_id bigint;
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_row from public.point_ledger where id = p_ledger_id and kind = 'admin_grant' and actor = uid;
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_row.created_at < now() - make_interval(mins => (lim ->> 'undoMinutes')::integer) then return jsonb_build_object('ok', false, 'reason', 'expired', 'limits', lim); end if;
  acc := public._points_account(v_row.user_id); -- 锁住对方账户，避免同时撤销两次
  if exists (select 1 from public.point_ledger where ref = p_ledger_id and kind = 'admin_revoke') then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if acc.balance < v_row.delta then return jsonb_build_object('ok', false, 'reason', 'insufficient'); end if;
  ledger_id := public._points_change(v_row.user_id, 'admin_revoke', -v_row.delta, p_ledger_id);
  update public.point_ledger set note = v_row.note, actor = uid where id = ledger_id;
  return jsonb_build_object('ok', true, 'amount', v_row.delta);
end;
$$;

revoke all on function public.admin_overview(), public.admin_ledger(text, date, date, bigint, integer, text), public.admin_lookup(text),
  public.admin_grant(text, integer, text), public.admin_undo(bigint) from public, anon;
grant execute on function public.admin_overview(), public.admin_ledger(text, date, date, bigint, integer, text), public.admin_lookup(text),
  public.admin_grant(text, integer, text), public.admin_undo(bigint) to authenticated;
