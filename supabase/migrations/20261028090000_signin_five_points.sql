-- Global daily sign-in rules: Beijing calendar day, once per day, fixed +5.
-- Preserves signup, unlimited balance, invitation bonus (+50), and all ledger semantics.
-- Applied to hosted Supabase on 2026-10-28.

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
  tz := 'Asia/Shanghai';
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
  tz := 'Asia/Shanghai';
  today := (now() at time zone tz)::date;
  if acc.last_signin_day = today then
    return jsonb_build_object('ok', false, 'reason', 'already', 'balance', acc.balance);
  end if;
  update public.point_accounts set timezone = 'Asia/Shanghai', last_signin_day = today where user_id = uid;
  perform public._points_change(uid, 'signin', 5);

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
  return jsonb_build_object('ok', true, 'delta', 5, 'inviteBonus', bonus, 'balance', acc.balance + 5 + bonus);
end;
$$;

