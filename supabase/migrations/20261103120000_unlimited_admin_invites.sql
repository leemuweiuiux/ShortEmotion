CREATE OR REPLACE FUNCTION public.invite_check(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_owner uuid;
begin
  if v_code !~ '^SE[A-HJKMNP-Z2-9]{6}$' then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  select user_id into v_owner from public.invite_codes where code = v_code;
  if v_owner is null then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if auth.uid() is not null and auth.uid() = v_owner then return jsonb_build_object('valid', false, 'reason', 'self'); end if;
  if not exists (select 1 from public.point_accounts where user_id = v_owner and unlimited = true)
     and (select count(*) from public.invites where inviter_id = v_owner) >= 5 then return jsonb_build_object('valid', false, 'reason', 'full'); end if;
  return jsonb_build_object('valid', true, 'code', v_code, 'name', public._invite_name(v_owner));
end;
$function$;

CREATE OR REPLACE FUNCTION public.invite_mine()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'limit', case when exists (select 1 from public.point_accounts where user_id = uid and unlimited = true) then null::integer else 5 end,
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
$function$;

CREATE OR REPLACE FUNCTION public.invite_redeem(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not exists (select 1 from public.point_accounts where user_id = v_owner and unlimited = true)
     and (select count(*) from public.invites where inviter_id = v_owner) >= 5 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into public.invites (invitee_id, inviter_id, code) values (uid, v_owner, v_code) on conflict (invitee_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  return jsonb_build_object('ok', true, 'name', public._invite_name(v_owner), 'reward', 50);
end;
$function$;
