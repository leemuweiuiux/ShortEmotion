-- 兑换码分享与领取（2026-11-05）
--   1. 短码：8 位（去掉 0/O/1/I/L 等易混字符），显示成 XXXX-XXXX；也可自定义口令（6–16 位字母数字）。
--      旧版后台不传 codeStyle / customCode 时仍生成 20 位码，行为不变。
--   2. 领取对象 audience：all 全部用户（默认）/ new 仅新用户（完成验证 7 天内）/ old 仅老用户（完成验证满 7 天）。
--   3. 公开预览 redemption_preview：落地页未登录也能看到活动名称、积分、截止与状态（不领取、不返回名单）。
--   4. 后台 stats：进行中的兑换码数、今日 / 近 7 日 / 累计领取。
-- 只做增量，旧版前端与已生成的兑换码照常可用。在 20261105030226_fix_redemption_list_alias.sql 之后执行。

alter table redemption_private.codes add column if not exists audience text not null default 'all'
  check (audience in ('all', 'new', 'old'));

-- 8 位短码：31 个不易混淆的字符，约 8.5×10^11 种组合；撞码时重抽。
create or replace function redemption_private.short_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  n bigint; s text;
begin
  loop
    n := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint;
    s := '';
    for i in 1..8 loop
      s := s || substr(alphabet, (n % 31)::integer + 1, 1);
      n := n / 31;
    end loop;
    exit when not exists (select 1 from redemption_private.codes where code = s);
  end loop;
  return s;
end $$;
revoke all on function redemption_private.short_code() from public, anon, authenticated;

create or replace function redemption_private.admin(p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c redemption_private.codes; v_id uuid; v_mode text; v_name text; v_amount integer;
 v_max integer; v_emails text[]; v_exp timestamptz; v_rows jsonb; v_filter text; v_before timestamptz;
 v_code text; v_custom text; v_audience text;
begin
 if not public._is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
 if p_action = 'create' then
  begin
   v_id := (p_payload->>'id')::uuid;
   v_amount := (p_payload->>'amount')::integer;
   v_max := nullif(p_payload->>'maxClaims', '')::integer;
   v_exp := nullif(p_payload->>'expiresAt', '')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
   return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end;
  v_mode := p_payload->>'mode'; v_name := btrim(p_payload->>'name');
  v_audience := coalesce(nullif(p_payload->>'audience', ''), 'all');
  v_custom := nullif(upper(regexp_replace(coalesce(p_payload->>'customCode', ''), '[[:space:]-]', '', 'g')), '');
  if v_id is null or v_name is null or length(v_name) not between 1 and 60 or v_mode is null or v_mode not in ('unlimited', 'limited', 'targeted')
   or v_amount is null or v_amount not between 1 and 1000 or length(coalesce(p_payload->>'note', '')) > 300
   or v_audience not in ('all', 'new', 'old')
   or (v_exp is not null and v_exp <= now()) then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  -- 自定义口令：6–16 位字母数字；不能长得像邀请码（SE + 6 位），以免用户填错地方。
  if v_custom is not null and (v_custom !~ '^[A-Z0-9]{6,16}$' or v_custom ~ '^SE[A-HJKMNP-Z2-9]{6}$') then
   return jsonb_build_object('ok', false, 'reason', 'bad_code'); end if;
  if v_mode = 'targeted' then v_audience := 'all'; end if; -- 定向名单本身就是领取对象
  perform pg_advisory_xact_lock(hashtextextended('redemption-admin:' || auth.uid()::text, 0));
  -- Client UUID makes create safe to retry after an ambiguous network response.
  select * into c from redemption_private.codes where id = v_id;
  if found then
   if c.creator <> auth.uid() then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
   return jsonb_build_object('ok', true, 'code', to_jsonb(c));
  end if;
  if (select count(*) from redemption_private.codes where creator = auth.uid() and created_at >= public._sh_day_start(0)) >= 50 then
   return jsonb_build_object('ok', false, 'reason', 'rate_limit'); end if;
  if v_mode = 'targeted' then
   if jsonb_typeof(p_payload->'emails') is distinct from 'array' then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
   select array_agg(distinct lower(btrim(e))) into v_emails from jsonb_array_elements_text(p_payload->'emails') e;
   if coalesce(cardinality(v_emails), 0) not between 1 and 500 or exists(select 1 from unnest(v_emails) e where e is null or length(e) > 254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
   v_max := cardinality(v_emails);
  elsif v_mode = 'unlimited' then v_max := null;
  elsif v_max is null or v_max not between 1 and 1000000 then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end if;
  if v_custom is not null then
   if exists(select 1 from redemption_private.codes where code = v_custom) then return jsonb_build_object('ok', false, 'reason', 'code_taken'); end if;
   v_code := v_custom;
  elsif p_payload->>'codeStyle' = 'short' then v_code := redemption_private.short_code();
  else v_code := upper(left(replace(gen_random_uuid()::text, '-', ''), 20));
  end if;
  begin
   insert into redemption_private.codes(id, code, name, mode, amount, max_claims, show_count, expires_at, note, creator, audience)
    values(v_id, v_code, v_name, v_mode, v_amount, v_max,
     v_mode = 'limited' and coalesce(p_payload->>'showCount', 'false') = 'true', v_exp, coalesce(p_payload->>'note', ''), auth.uid(), v_audience) returning * into c;
  exception when unique_violation then
   return jsonb_build_object('ok', false, 'reason', 'code_taken');
  end;
  if v_mode = 'targeted' then insert into redemption_private.targets select v_id, unnest(v_emails); end if;
  return jsonb_build_object('ok', true, 'code', to_jsonb(c));
 end if;
 if p_action = 'list' then
  v_filter := nullif(btrim(p_payload->>'search'), '');
  begin v_before := nullif(p_payload->>'before', '')::timestamptz;
  exception when others then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_rows from (
   select code_entry.*, code_entry.claimed::bigint * code_entry.amount as issued,
    case when code_entry.disabled_at is not null then 'disabled' when code_entry.expires_at <= now() then 'expired'
     when code_entry.max_claims is not null and code_entry.claimed >= code_entry.max_claims then 'full' else 'active' end as status
   from redemption_private.codes code_entry where (v_filter is null or code_entry.name ilike '%' || v_filter || '%' or code_entry.code ilike '%' || upper(replace(v_filter, '-', '')) || '%')
    and (nullif(p_payload->>'mode', '') is null or code_entry.mode = p_payload->>'mode')
    and (v_before is null or code_entry.created_at < v_before)
    and (nullif(p_payload->>'status', '') is null or (case when code_entry.disabled_at is not null then 'disabled' when code_entry.expires_at <= now() then 'expired' when code_entry.max_claims is not null and code_entry.claimed >= code_entry.max_claims then 'full' else 'active' end) = p_payload->>'status')
   order by code_entry.created_at desc limit 50
  ) r;
  return jsonb_build_object('ok', true, 'rows', v_rows);
 end if;
 if p_action = 'stats' then
  return jsonb_build_object('ok', true,
   'active', (select count(*) from redemption_private.codes code_entry where code_entry.disabled_at is null
     and (code_entry.expires_at is null or code_entry.expires_at > now()) and (code_entry.max_claims is null or code_entry.claimed < code_entry.max_claims)),
   'today', (select jsonb_build_object('users', count(distinct cl.user_id), 'points', coalesce(sum(cl.amount), 0))
     from redemption_private.claims cl where cl.created_at >= public._sh_day_start(0)),
   'week', (select jsonb_build_object('users', count(distinct cl.user_id), 'points', coalesce(sum(cl.amount), 0))
     from redemption_private.claims cl where cl.created_at >= public._sh_day_start(6)),
   'total', (select jsonb_build_object('claims', count(*), 'points', coalesce(sum(cl.amount), 0)) from redemption_private.claims cl));
 end if;
 begin v_id := (p_payload->>'id')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('ok', false, 'reason', 'bad_input'); end;
 select * into c from redemption_private.codes where id = v_id for update;
 if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
 if p_action = 'disable' then
  update redemption_private.codes set disabled_at = coalesce(disabled_at, now()), disabled_by = coalesce(disabled_by, auth.uid()) where id = v_id;
  return jsonb_build_object('ok', true);
 end if;
 if p_action = 'detail' then
  return jsonb_build_object('ok', true, 'code', to_jsonb(c) || jsonb_build_object('creatorCode', public._user_code(c.creator)), 'claims', coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from (
   select cl.id, public._user_code(cl.user_id) as user_code, cl.email, cl.amount, cl.created_at, cl.ledger_id
    from redemption_private.claims cl where cl.code_id = v_id and (nullif(p_payload->>'before', '') is null or cl.id < (p_payload->>'before')::bigint) order by cl.id desc limit 50
  ) r), '[]'::jsonb), 'targets', coalesce((select jsonb_agg(jsonb_build_object('email', t.email, 'claimed', exists(select 1 from redemption_private.claims cl where cl.code_id = t.code_id and cl.email = t.email)) order by t.email)
   from redemption_private.targets t where t.code_id = v_id), '[]'::jsonb));
 end if;
 return jsonb_build_object('ok', false, 'reason', 'bad_input');
end $$;

-- 领取：在原有检查后加上领取对象（新 / 老用户）；预览多返回 mode、audience，方便页面说明。
create or replace function redemption_private.redeem(p_code text, p_claim boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); em text; verified timestamptz; c redemption_private.codes; acc public.point_accounts; lid bigint; attempt redemption_private.attempts; claimed_at timestamptz;
begin
 if uid is null then raise exception 'login required' using errcode = '28000'; end if;
 select lower(email), email_confirmed_at into em, verified from auth.users where id = uid;
 if verified is null then return jsonb_build_object('ok', false, 'reason', 'unverified'); end if;
 insert into redemption_private.attempts(user_id) values(uid) on conflict do nothing;
 select * into attempt from redemption_private.attempts where user_id = uid for update;
 if attempt.window_start < now() - interval '1 minute' then
  update redemption_private.attempts set n = 1, window_start = now() where user_id = uid;
 elsif attempt.n >= 20 then return jsonb_build_object('ok', false, 'reason', 'rate_limit');
 else update redemption_private.attempts set n = n + 1 where user_id = uid; end if;
 select * into c from redemption_private.codes where code = upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g')) for update;
 if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
 select cl.created_at into claimed_at from redemption_private.claims cl where cl.code_id = c.id and (cl.user_id = uid or cl.email = em) limit 1;
 if found then return jsonb_build_object('ok', false, 'reason', 'already', 'claimedAt', claimed_at, 'name', c.name, 'amount', c.amount); end if;
 if c.disabled_at is not null then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
 if c.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
 if c.mode = 'targeted' and not exists(select 1 from redemption_private.targets where code_id = c.id and email = em) then return jsonb_build_object('ok', false, 'reason', 'ineligible'); end if;
 if c.audience = 'new' and verified < now() - interval '7 days' then return jsonb_build_object('ok', false, 'reason', 'audience_new'); end if;
 if c.audience = 'old' and verified >= now() - interval '7 days' then return jsonb_build_object('ok', false, 'reason', 'audience_old'); end if;
 if c.max_claims is not null and c.claimed >= c.max_claims then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
 if not coalesce(p_claim, false) then
  return jsonb_build_object('ok', true, 'name', c.name, 'amount', c.amount, 'expiresAt', c.expires_at, 'mode', c.mode, 'audience', c.audience,
    'claimed', case when c.show_count then c.claimed end, 'maxClaims', case when c.show_count then c.max_claims end);
 end if;
 acc := public._points_account(uid);
 lid := public._points_change(uid, 'redemption', c.amount);
 update public.point_ledger set note = c.name, actor = c.creator where id = lid;
 insert into redemption_private.claims(code_id, user_id, email, amount, ledger_id) values(c.id, uid, em, c.amount, lid);
 update redemption_private.codes set claimed = claimed + 1 where id = c.id;
 return jsonb_build_object('ok', true, 'amount', c.amount, 'balance', acc.balance + c.amount, 'unlimited', acc.unlimited, 'ledgerId', lid, 'name', c.name);
end $$;

-- 公开预览（落地页，未登录也可调用）：只返回活动名称、积分、截止、领取对象与状态；
-- 已兑换人数只在后台勾选「向用户显示」时返回。不领取、不记录，也不返回任何用户信息。
create or replace function public.redemption_preview(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c redemption_private.codes; v text := upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'));
begin
 if v !~ '^[A-Z0-9]{6,20}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
 select * into c from redemption_private.codes where code = v;
 if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
 return jsonb_build_object('ok', true, 'code', c.code, 'name', c.name, 'amount', c.amount, 'mode', c.mode, 'audience', c.audience, 'expiresAt', c.expires_at,
  'status', case when c.disabled_at is not null then 'disabled' when c.expires_at <= now() then 'expired'
   when c.max_claims is not null and c.claimed >= c.max_claims then 'full' else 'active' end,
  'claimed', case when c.show_count then c.claimed end, 'maxClaims', case when c.show_count then c.max_claims end);
end $$;
revoke all on function public.redemption_preview(text) from public;
grant execute on function public.redemption_preview(text) to anon, authenticated;
