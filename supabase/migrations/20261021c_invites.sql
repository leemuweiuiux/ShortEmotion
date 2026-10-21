-- 邀请好友（2026-10-21 与产品确认）
--   每人一个固定邀请码：SE + 6 位（去掉容易看错的 0/O、1/I/L），第一次打开「邀请好友」页时生成。
--   新用户在登录页填邀请码（选填）；验证码通过、登录完成后才绑定。
--   只限刚注册的账号（注册 1 天内、还没签到过），不能填自己的码，每个账号只能绑定一次。
--   每个邀请码最多绑定 5 位好友（按绑定人数算，含还没签到的）。
--   好友完成第一次签到时，双方各 +50（流水：邀请好友奖励 / 受邀奖励）。
--   邀请卡与落地页显示邀请人的姓名（个人资料里的姓名）；没填时页面显示「好友」。
-- 在之前的积分迁移（20261020_points.sql、20261020b、20261021、20261021b）之后，于 Supabase → SQL Editor 执行一次。

create table if not exists public.invite_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^SE[A-HJKMNP-Z2-9]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  invitee_id uuid primary key references auth.users (id) on delete cascade,   -- 每个账号只能被邀请一次
  inviter_id uuid not null references auth.users (id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz                                                      -- 好友第一次签到、双方入账的时间
);
create index if not exists invites_inviter_idx on public.invites (inviter_id, created_at desc);

alter table public.invite_codes enable row level security;
alter table public.invites enable row level security;
revoke all on table public.invite_codes, public.invites from anon, authenticated;

alter table public.point_ledger drop constraint if exists point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check
  check (kind in ('signup', 'signin', 'refresh', 'unlock', 'refund', 'analysis', 'analysis_refund', 'invite_reward', 'invite_bonus'));

-- 个人资料里的姓名（没填返回 null），最多 20 个字
create or replace function public._invite_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'display_name', '')), ''), 20)
  from auth.users u where u.id = uid;
$$;

-- 给邀请人看的好友名称：姓名；没填就用打码的邮箱（例如 le***@gmail.com）
create or replace function public._invite_label(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public._invite_name(uid),
    case when position('@' in coalesce(u.email, '')) > 1
      then left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2)
      else '新用户' end)
  from auth.users u where u.id = uid;
$$;

-- 随机生成一个邀请码（31 个字符：不含 0、O、1、I、L）
create or replace function public._invite_new_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := 'SE';
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

revoke all on function public._invite_name(uuid), public._invite_label(uuid), public._invite_new_code() from public, anon, authenticated;

-- 我的邀请：邀请码（没有就生成）、姓名、上限、已邀请 / 已完成人数、累计获得积分、好友列表（最新在前）
create or replace function public.invite_mine()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_code text;
  tries integer := 0;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  select code into v_code from public.invite_codes where user_id = uid;
  while v_code is null loop
    tries := tries + 1;
    begin
      insert into public.invite_codes (user_id, code) values (uid, public._invite_new_code())
      on conflict (user_id) do nothing
      returning code into v_code;
      if v_code is null then select code into v_code from public.invite_codes where user_id = uid; end if;
    exception when unique_violation then
      if tries >= 8 then raise; end if;  -- 邀请码撞号：换一个再试
    end;
  end loop;
  return jsonb_build_object(
    'code', v_code,
    'name', public._invite_name(uid),
    'limit', 5,
    'reward', 50,
    'invited', (select count(*) from public.invites where inviter_id = uid),
    'rewarded', (select count(*) from public.invites where inviter_id = uid and rewarded_at is not null),
    'earned', (select coalesce(sum(delta), 0) from public.point_ledger where user_id = uid and kind = 'invite_reward'),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('label', public._invite_label(i.invitee_id), 'joinedAt', i.created_at, 'rewarded', i.rewarded_at is not null) order by i.created_at desc)
      from public.invites i where i.inviter_id = uid
    ), '[]'::jsonb)
  );
end;
$$;

-- 检查邀请码（登录前也能调用）：能不能用、邀请人姓名
create or replace function public.invite_check(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_owner uuid;
begin
  if v_code !~ '^SE[A-HJKMNP-Z2-9]{6}$' then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  select user_id into v_owner from public.invite_codes where code = v_code;
  if v_owner is null then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if auth.uid() is not null and auth.uid() = v_owner then return jsonb_build_object('valid', false, 'reason', 'self'); end if;
  if (select count(*) from public.invites where inviter_id = v_owner) >= 5 then return jsonb_build_object('valid', false, 'reason', 'full'); end if;
  return jsonb_build_object('valid', true, 'code', v_code, 'name', public._invite_name(v_owner));
end;
$$;

-- 登录完成后绑定邀请人：只限刚注册的账号；同一个邀请码的绑定排队执行，不会超过 5 人
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
  v_created timestamptz;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  if v_code !~ '^SE[A-HJKMNP-Z2-9]{6}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select user_id into v_owner from public.invite_codes where code = v_code for update;
  if v_owner is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if v_owner = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from public.invites where invitee_id = uid) then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  select created_at into v_created from auth.users where id = uid;
  if v_created is null or v_created < now() - interval '1 day'
     or exists (select 1 from public.point_ledger where user_id = uid and kind = 'signin') then
    return jsonb_build_object('ok', false, 'reason', 'not_new');
  end if;
  if (select count(*) from public.invites where inviter_id = v_owner) >= 5 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into public.invites (invitee_id, inviter_id, code) values (uid, v_owner, v_code) on conflict (invitee_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  return jsonb_build_object('ok', true, 'name', public._invite_name(v_owner), 'reward', 50);
end;
$$;

-- 余额等状态，多一项 invitePending：已绑定邀请人、还没完成第一次签到（页面提示「签到后双方各得 50 积分」）
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
    'invitePending', exists (select 1 from public.invites where invitee_id = uid and rewarded_at is null)
  );
end;
$$;

-- 每日签到 +10；被邀请的新用户第一次签到时，双方再各 +50
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
  v_inviter uuid;
  ledger_id bigint;
  bonus integer := 0;
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

  select inviter_id into v_inviter from public.invites where invitee_id = uid and rewarded_at is null for update;
  if v_inviter is not null then
    update public.invites set rewarded_at = now() where invitee_id = uid;
    bonus := 50;
    ledger_id := public._points_change(uid, 'invite_bonus', bonus);
    update public.point_ledger set note = public._invite_name(v_inviter) where id = ledger_id;
    perform public._points_account(v_inviter);
    ledger_id := public._points_change(v_inviter, 'invite_reward', 50);
    update public.point_ledger set note = public._invite_label(uid) where id = ledger_id;
  end if;
  return jsonb_build_object('ok', true, 'delta', 10, 'inviteBonus', bonus, 'balance', acc.balance + 10 + bonus);
end;
$$;

revoke all on function public.invite_mine(), public.invite_check(text), public.invite_redeem(text),
  public.points_status(text), public.points_signin(text) from public, anon;
grant execute on function public.invite_mine(), public.invite_redeem(text), public.points_status(text), public.points_signin(text) to authenticated;
grant execute on function public.invite_check(text) to anon, authenticated;

-- 运营查看（只在 SQL Editor 用）：多两栏，邀请绑定数与已发奖励数
create or replace view public.points_overview with (security_invoker = true) as
select
  (select count(*) from public.point_accounts)                                                     as accounts,
  (select coalesce(sum(balance), 0) from public.point_accounts)                                     as total_balance,
  (select count(*) from public.point_ledger where kind = 'signin' and created_at > now() - interval '1 day')  as signins_24h,
  (select count(*) from public.point_ledger where kind = 'refresh' and created_at > now() - interval '1 day') as refreshes_24h,
  (select count(*) from public.point_ledger where kind = 'unlock' and created_at > now() - interval '1 day')  as unlocks_24h,
  (select count(*) from public.point_ledger where kind = 'analysis' and created_at > now() - interval '1 day') as analyses_24h,
  (select count(*) from public.invites)                                                            as invites,
  (select count(*) from public.invites where rewarded_at is not null)                              as invites_rewarded;
revoke all on table public.points_overview from anon, authenticated;
