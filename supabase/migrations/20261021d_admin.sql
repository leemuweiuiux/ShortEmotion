-- 管理后台（2026-10-21 与产品确认）
--   只给管理员名单里的人用；名单只在 SQL Editor 加减（后台没有入口）。
--   三页：总览（只有统计数字）、积分列表（全站流水：时间、类型、变动；不显示用户、余额、备注）、积分发放。
--   积分发放：按登录邮箱发给某位用户；只能发、不能扣；每次 1–1000 分；每位管理员每天（北京时间）最多 50 笔；
--   原因二选一：积分充值、活动奖励（记在流水备注，用户在自己的积分记录里看得到「平台发放 · 活动奖励」）。
--   暂不做：用户列表、不限额开关、操作日志。
-- 权限在数据库检查：每个 admin_* 函数先确认调用的人在管理员名单里，不是就报错（接口回 404）。
-- 在之前的迁移之后，于 Supabase → SQL Editor 执行一次。

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

-- 第一位管理员（按登录邮箱；这个邮箱要先在网站登录过一次）
insert into public.admin_users (user_id)
select id from auth.users where lower(email) = 'leemuwei0227@gmail.com'
on conflict (user_id) do nothing;

-- 流水：平台发放；actor 记下是哪位管理员发的（用来算每天的笔数上限）
alter table public.point_ledger add column if not exists actor uuid references auth.users (id) on delete set null;
alter table public.point_ledger drop constraint if exists point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check
  check (kind in ('signup', 'signin', 'refresh', 'unlock', 'refund', 'analysis', 'analysis_refund', 'invite_reward', 'invite_bonus', 'admin_grant'));
create index if not exists point_ledger_created_idx on public.point_ledger (created_at desc);
create index if not exists point_ledger_admin_grant_idx on public.point_ledger (actor, created_at) where kind = 'admin_grant';

-- 调用的人是不是管理员
create or replace function public._is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- 北京时间某一天 00:00（p_days_ago = 0 是今天）
create or replace function public._sh_day_start(p_days_ago integer default 0)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (((now() at time zone 'Asia/Shanghai')::date - p_days_ago)::timestamp) at time zone 'Asia/Shanghai';
$$;

revoke all on function public._is_admin(), public._sh_day_start(integer) from public, anon, authenticated;

-- 是不是管理员（middleware 用来决定 /admin 显示后台还是 404）
create or replace function public.admin_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('admin', public._is_admin());
$$;

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
    'invites', jsonb_build_object(
      'bound', (select count(*) from public.invites),
      'rewarded', (select count(*) from public.invites where rewarded_at is not null)
    ),
    'analyses', jsonb_build_object(
      'today', (select count(*) filter (where kind = 'analysis') - count(*) filter (where kind = 'analysis_refund')
                from public.point_ledger where created_at >= today_start and kind in ('analysis', 'analysis_refund')),
      'week', (select count(*) filter (where kind = 'analysis') - count(*) filter (where kind = 'analysis_refund')
               from public.point_ledger where created_at >= week_start and kind in ('analysis', 'analysis_refund'))
    ),
    'grants', jsonb_build_object(
      'myToday', (select count(*) from public.point_ledger where kind = 'admin_grant' and actor = uid and created_at >= today_start),
      'dailyLimit', 50,
      'maxAmount', 1000
    )
  );
end;
$$;

-- 积分列表：全站流水，最新在前；只有时间、类型、变动（不返回用户、余额、备注）
create or replace function public.admin_ledger(p_kind text default null, p_from date default null, p_to date default null, p_before bigint default null, p_limit integer default 50)
returns table (id bigint, kind text, delta integer, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select l.id, l.kind, l.delta, l.created_at
    from public.point_ledger l
    where (p_kind is null or l.kind = p_kind)
      and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Shanghai'))
      and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Shanghai'))
      and (p_before is null or l.id < p_before)
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- 积分发放：只能发、不能扣；每次 1–1000 分；每位管理员每天最多 50 笔；原因二选一
create or replace function public.admin_grant(p_email text, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_label text;
  v_today integer;
  v_target uuid;
  ledger_id bigint;
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_label := case p_reason when 'recharge' then '积分充值' when 'campaign' then '活动奖励' end;
  if v_label is null then return jsonb_build_object('ok', false, 'reason', 'bad_reason'); end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  -- 同一位管理员的发放排队执行，每天的笔数不会超过上限
  perform pg_advisory_xact_lock(hashtext('admin_grant:' || uid::text));
  select count(*) into v_today from public.point_ledger where kind = 'admin_grant' and actor = uid and created_at >= public._sh_day_start(0);
  if v_today >= 50 then return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'myToday', v_today); end if;
  select id into v_target from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_target is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public._points_account(v_target);
  ledger_id := public._points_change(v_target, 'admin_grant', p_amount);
  update public.point_ledger set note = v_label, actor = uid where id = ledger_id;
  return jsonb_build_object('ok', true, 'amount', p_amount, 'reasonLabel', v_label, 'myToday', v_today + 1, 'dailyLimit', 50);
end;
$$;

revoke all on function public.admin_me(), public.admin_overview(), public.admin_ledger(text, date, date, bigint, integer),
  public.admin_grant(text, integer, text) from public, anon;
grant execute on function public.admin_me(), public.admin_overview(), public.admin_ledger(text, date, date, bigint, integer),
  public.admin_grant(text, integer, text) to authenticated;

-- 管理员名单（在 SQL Editor 查看 / 加减）：
--   select u.email, a.created_at from public.admin_users a join auth.users u on u.id = a.user_id;
--   insert into public.admin_users (user_id) select id from auth.users where lower(email) = '某人@example.com';
--   delete from public.admin_users where user_id = (select id from auth.users where lower(email) = '某人@example.com');
