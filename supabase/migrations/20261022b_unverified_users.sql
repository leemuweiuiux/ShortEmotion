-- 未完成邮箱验证的账号（2026-10-22 与产品确认）
--   在登录页「发送验证码」时，Supabase 就先建好账号（Waiting for verification）；输错邮箱的人永远不会验证，不长期保留。
--   1. 清理：每天北京时间 04:10 执行一次，删除「建立超过 1 天、从没完成验证、从没登录成功、我们自己的表里没有任何资料」的账号。
--      用 Supabase Cron（pg_cron）在数据库里执行，不需要任何密钥，也不经过网站或 GitHub。
--   2. 「注册」一律从完成验证算起（email_confirmed_at）：管理后台的用户数、今日 / 7 日新增；邀请码「注册 1 天内」的资格。
--   3. 积分发放只给验证过的账号。
-- 在 20261022_invite_entry.sql 之后，于 Supabase → SQL Editor 执行一次（会开启 pg_cron 扩展）。
--
-- 执行前可以先看会删掉几个（只读）：
--   select count(*) from auth.users where email_confirmed_at is null and phone_confirmed_at is null
--     and last_sign_in_at is null and created_at < now() - interval '1 day';
-- 之后查看每天的执行结果：
--   select start_time, status, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'cleanup-unverified-users') order by start_time desc limit 7;

-- ── 1. 清理未验证账号 ──
create or replace function public._cleanup_unverified_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from auth.users u
  where u.email_confirmed_at is null
    and u.phone_confirmed_at is null
    and u.last_sign_in_at is null
    and u.created_at < now() - interval '1 day'
    -- 双保险：我们自己的表里有任何资料就不删（正常情况下未验证的账号不会有）
    and not exists (select 1 from public.point_accounts a where a.user_id = u.id)
    and not exists (select 1 from public.point_ledger l where l.user_id = u.id or l.actor = u.id)
    and not exists (select 1 from public.invite_codes c where c.user_id = u.id)
    and not exists (select 1 from public.invites i where i.invitee_id = u.id or i.inviter_id = u.id)
    and not exists (select 1 from public.analysis_history h where h.user_id = u.id)
    and not exists (select 1 from public.daily_active d where d.user_id = u.id)
    and not exists (select 1 from public.admin_users m where m.user_id = u.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public._cleanup_unverified_users() from public, anon, authenticated;

-- ── 2. 管理后台总览：用户数只算验证过的；新增按完成验证的时间 ──
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
      'total', (select count(*) from auth.users where email_confirmed_at is not null),
      'newToday', (select count(*) from auth.users where email_confirmed_at >= today_start),
      'new7d', (select count(*) from auth.users where email_confirmed_at >= week_start),
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

-- ── 3. 积分发放：只找验证过的账号；「注册于」＝完成验证的时间 ──
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
  select id, email, email_confirmed_at into v_user from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_user.id is null then return jsonb_build_object('found', false, 'reason', 'not_found'); end if;
  if v_user.email_confirmed_at is null then return jsonb_build_object('found', false, 'reason', 'unverified'); end if;
  return jsonb_build_object('found', true, 'masked', public._mask_email(v_user.email), 'registeredAt', v_user.email_confirmed_at, 'userCode', public._user_code(v_user.id));
end;
$$;

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
  v_confirmed timestamptz;
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
  select id, email, email_confirmed_at into v_target, v_email, v_confirmed from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_target is null then return jsonb_build_object('ok', false, 'reason', 'not_found', 'limits', lim); end if;
  if v_confirmed is null then return jsonb_build_object('ok', false, 'reason', 'unverified', 'limits', lim); end if;
  perform public._points_account(v_target);
  ledger_id := public._points_change(v_target, 'admin_grant', p_amount);
  update public.point_ledger set note = v_label, actor = uid where id = ledger_id;
  return jsonb_build_object('ok', true, 'ledgerId', ledger_id, 'amount', p_amount, 'reasonLabel', v_label, 'masked', public._mask_email(v_email),
    'myToday', v_today + 1, 'undoUntil', now() + make_interval(mins => (lim ->> 'undoMinutes')::integer), 'limits', lim);
end;
$$;

-- ── 4. 邀请码：「注册 1 天内」从完成验证算起 ──
create or replace function public.invite_redeem(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_owner uuid;
  v_verified timestamptz;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  if v_code !~ '^SE[A-HJKMNP-Z2-9]{6}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select user_id into v_owner from public.invite_codes where code = v_code for update;
  if v_owner is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if v_owner = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from public.invites where invitee_id = uid) then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  select email_confirmed_at into v_verified from auth.users where id = uid;
  if v_verified is null or v_verified < now() - interval '1 day'
     or exists (select 1 from public.point_ledger where user_id = uid and kind = 'signin') then
    return jsonb_build_object('ok', false, 'reason', 'not_new');
  end if;
  if (select count(*) from public.invites where inviter_id = v_owner) >= 5 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into public.invites (invitee_id, inviter_id, code) values (uid, v_owner, v_code) on conflict (invitee_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  return jsonb_build_object('ok', true, 'name', public._invite_name(v_owner), 'reward', 50);
end;
$$;

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
    'unlimited', acc.unlimited,
    'signedToday', acc.last_signin_day is not null and acc.last_signin_day = (now() at time zone tz)::date,
    'unlockUntil', case when acc.unlock_until > now() then acc.unlock_until end,
    'timezone', tz,
    'invitePending', exists (select 1 from public.invites where invitee_id = uid and rewarded_at is null),
    'inviteEligible', not acc.unlimited
      and not exists (select 1 from public.invites where invitee_id = uid)
      and not exists (select 1 from public.point_ledger where user_id = uid and kind = 'signin')
      and exists (select 1 from auth.users where id = uid and email_confirmed_at >= now() - interval '1 day')
  );
end;
$$;

revoke all on function public.points_status(text) from public, anon;
grant execute on function public.points_status(text) to authenticated;

-- ── 5. 每天北京时间 04:10（UTC 20:10）执行清理 ──
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('cleanup-unverified-users', '10 20 * * *', 'select public._cleanup_unverified_users()');
