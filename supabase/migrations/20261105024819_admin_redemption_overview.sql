-- 积分兑换：规则、名单与记录只允许受控 RPC 访问；兑换、占额及到账在同一事务完成。
create schema if not exists redemption_private;
revoke all on schema redemption_private from public;
grant usage on schema redemption_private to authenticated;
create table redemption_private.codes (
 id uuid primary key, code text not null unique,
 name text not null check(length(name) between 1 and 60),
 mode text not null check(mode in ('unlimited','limited','targeted')),
 amount integer not null check(amount between 1 and 1000),
 max_claims integer check(max_claims between 1 and 1000000),
 show_count boolean not null default false,
 claimed integer not null default 0 check(claimed>=0),
 expires_at timestamptz, disabled_at timestamptz, disabled_by uuid,
 note text not null default '' check(length(note)<=300),
 created_at timestamptz not null default now(), creator uuid references auth.users(id) on delete set null,
 check((mode='unlimited' and max_claims is null) or (mode<>'unlimited' and max_claims is not null)),
 check(max_claims is null or claimed<=max_claims)
);
create table redemption_private.targets (
 code_id uuid references redemption_private.codes(id), email text not null, primary key(code_id,email)
);
create table redemption_private.claims (
 id bigint generated always as identity primary key,
 code_id uuid not null references redemption_private.codes(id),
 user_id uuid references auth.users(id) on delete set null,
 email text not null, amount integer not null,
 ledger_id bigint not null unique, created_at timestamptz not null default now(),
 unique(code_id,user_id), unique(code_id,email)
);
create index redemption_claims_code_id on redemption_private.claims(code_id,id desc);
create index redemption_codes_created on redemption_private.codes(created_at desc);
create table redemption_private.attempts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 window_start timestamptz not null default now(), n integer not null default 0
);
alter table redemption_private.codes enable row level security;
alter table redemption_private.targets enable row level security;
alter table redemption_private.claims enable row level security;
alter table redemption_private.attempts enable row level security;
revoke all on all tables in schema redemption_private from public,anon,authenticated;
revoke all on all sequences in schema redemption_private from public,anon,authenticated;
alter table public.point_ledger drop constraint point_ledger_kind_check;
alter table public.point_ledger add constraint point_ledger_kind_check check(kind in
 ('signup','signin','refresh','unlock','refund','analysis','analysis_refund','invite_reward','invite_bonus','admin_grant','admin_revoke','unlock_limitup','unlock_sectorflow','unlock_etfflow','redemption'));

create function redemption_private.admin(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c redemption_private.codes; v_id uuid; v_mode text; v_name text; v_amount integer;
 v_max integer; v_emails text[]; v_exp timestamptz; v_rows jsonb; v_filter text; v_before timestamptz;
begin
 if not public._is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_action='create' then
  begin
   v_id:=(p_payload->>'id')::uuid;
   v_amount:=(p_payload->>'amount')::integer;
   v_max:=nullif(p_payload->>'maxClaims','')::integer;
   v_exp:=nullif(p_payload->>'expiresAt','')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
   return jsonb_build_object('ok',false,'reason','bad_input');
  end;
  v_mode:=p_payload->>'mode'; v_name:=btrim(p_payload->>'name');
  if v_id is null or v_name is null or length(v_name) not between 1 and 60 or v_mode is null or v_mode not in ('unlimited','limited','targeted')
   or v_amount is null or v_amount not between 1 and 1000 or length(coalesce(p_payload->>'note',''))>300
   or (v_exp is not null and v_exp<=now()) then return jsonb_build_object('ok',false,'reason','bad_input'); end if;
  perform pg_advisory_xact_lock(hashtextextended('redemption-admin:'||auth.uid()::text,0));
  -- Client UUID makes create safe to retry after an ambiguous network response.
  select * into c from redemption_private.codes where id=v_id;
  if found then
   if c.creator<>auth.uid() then return jsonb_build_object('ok',false,'reason','bad_input'); end if;
   return jsonb_build_object('ok',true,'code',to_jsonb(c));
  end if;
  if (select count(*) from redemption_private.codes where creator=auth.uid() and created_at>=public._sh_day_start(0))>=50 then
   return jsonb_build_object('ok',false,'reason','rate_limit'); end if;
  if v_mode='targeted' then
   if jsonb_typeof(p_payload->'emails') is distinct from 'array' then return jsonb_build_object('ok',false,'reason','bad_input'); end if;
   select array_agg(distinct lower(btrim(e))) into v_emails from jsonb_array_elements_text(p_payload->'emails') e;
   if coalesce(cardinality(v_emails),0) not between 1 and 500 or exists(select 1 from unnest(v_emails) e where e is null or length(e)>254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    return jsonb_build_object('ok',false,'reason','bad_input'); end if;
   v_max:=cardinality(v_emails);
  elsif v_mode='unlimited' then v_max:=null;
  elsif v_max is null or v_max not between 1 and 1000000 then return jsonb_build_object('ok',false,'reason','bad_input'); end if;
  insert into redemption_private.codes(id,code,name,mode,amount,max_claims,show_count,expires_at,note,creator)
   values(v_id,upper(left(replace(gen_random_uuid()::text,'-',''),20)),v_name,v_mode,v_amount,v_max,
    v_mode='limited' and coalesce(p_payload->>'showCount','false')='true',v_exp,coalesce(p_payload->>'note',''),auth.uid()) returning * into c;
  if v_mode='targeted' then insert into redemption_private.targets select v_id,unnest(v_emails); end if;
  return jsonb_build_object('ok',true,'code',to_jsonb(c));
 end if;
 if p_action='list' then
  v_filter:=nullif(btrim(p_payload->>'search'),'');
  begin v_before:=nullif(p_payload->>'before','')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'reason','bad_input'); end;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) into v_rows from (
   select c.*, c.claimed::bigint*c.amount as issued,
    case when c.disabled_at is not null then 'disabled' when c.expires_at<=now() then 'expired'
     when c.max_claims is not null and c.claimed>=c.max_claims then 'full' else 'active' end as status
   from redemption_private.codes c where (v_filter is null or c.name ilike '%'||v_filter||'%' or c.code ilike '%'||replace(v_filter,'-','')||'%')
    and (nullif(p_payload->>'mode','') is null or c.mode=p_payload->>'mode')
    and (v_before is null or c.created_at<v_before)
    and (nullif(p_payload->>'status','') is null or (case when c.disabled_at is not null then 'disabled' when c.expires_at<=now() then 'expired' when c.max_claims is not null and c.claimed>=c.max_claims then 'full' else 'active' end)=p_payload->>'status')
   order by c.created_at desc limit 50
  ) r;
  return jsonb_build_object('ok',true,'rows',v_rows);
 end if;
 begin v_id:=(p_payload->>'id')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('ok',false,'reason','bad_input'); end;
 select * into c from redemption_private.codes where id=v_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
 if p_action='disable' then
  update redemption_private.codes set disabled_at=coalesce(disabled_at,now()),disabled_by=coalesce(disabled_by,auth.uid()) where id=v_id;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='detail' then
  return jsonb_build_object('ok',true,'code',to_jsonb(c)||jsonb_build_object('creatorCode',public._user_code(c.creator)),'claims',coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from (
   select cl.id,public._user_code(cl.user_id) as user_code,cl.email,cl.amount,cl.created_at,cl.ledger_id
    from redemption_private.claims cl where cl.code_id=v_id and (nullif(p_payload->>'before','') is null or cl.id<(p_payload->>'before')::bigint) order by cl.id desc limit 50
  ) r),'[]'::jsonb),'targets',coalesce((select jsonb_agg(jsonb_build_object('email',t.email,'claimed',exists(select 1 from redemption_private.claims cl where cl.code_id=t.code_id and cl.email=t.email)) order by t.email)
   from redemption_private.targets t where t.code_id=v_id),'[]'::jsonb));
 end if;
 return jsonb_build_object('ok',false,'reason','bad_input');
end $$;
revoke all on function redemption_private.admin(text,jsonb) from public,anon;
grant execute on function redemption_private.admin(text,jsonb) to authenticated;
create function public.admin_redemption(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select redemption_private.admin(p_action,p_payload); $$;
revoke all on function public.admin_redemption(text,jsonb) from public,anon;
grant execute on function public.admin_redemption(text,jsonb) to authenticated;

create function redemption_private.redeem(p_code text,p_claim boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); em text; verified timestamptz; c redemption_private.codes; acc public.point_accounts; lid bigint; attempt redemption_private.attempts;
begin
 if uid is null then raise exception 'login required' using errcode='28000'; end if;
 select lower(email),email_confirmed_at into em,verified from auth.users where id=uid;
 if verified is null then return jsonb_build_object('ok',false,'reason','unverified'); end if;
 insert into redemption_private.attempts(user_id) values(uid) on conflict do nothing;
 select * into attempt from redemption_private.attempts where user_id=uid for update;
 if attempt.window_start<now()-interval '1 minute' then
  update redemption_private.attempts set n=1,window_start=now() where user_id=uid;
 elsif attempt.n>=20 then return jsonb_build_object('ok',false,'reason','rate_limit');
 else update redemption_private.attempts set n=n+1 where user_id=uid; end if;
 select * into c from redemption_private.codes where code=upper(regexp_replace(coalesce(p_code,''),'[[:space:]-]','','g')) for update;
 if not found then return jsonb_build_object('ok',false,'reason','invalid'); end if;
 if exists(select 1 from redemption_private.claims where code_id=c.id and (user_id=uid or email=em)) then return jsonb_build_object('ok',false,'reason','already'); end if;
 if c.disabled_at is not null then return jsonb_build_object('ok',false,'reason','disabled'); end if;
 if c.expires_at<=now() then return jsonb_build_object('ok',false,'reason','expired'); end if;
 if c.mode='targeted' and not exists(select 1 from redemption_private.targets where code_id=c.id and email=em) then return jsonb_build_object('ok',false,'reason','ineligible'); end if;
 if c.max_claims is not null and c.claimed>=c.max_claims then return jsonb_build_object('ok',false,'reason','full'); end if;
 if not coalesce(p_claim,false) then
  return jsonb_build_object('ok',true,'name',c.name,'amount',c.amount,'expiresAt',c.expires_at,
    'claimed',case when c.show_count then c.claimed end,'maxClaims',case when c.show_count then c.max_claims end);
 end if;
 acc:=public._points_account(uid);
 lid:=public._points_change(uid,'redemption',c.amount);
 update public.point_ledger set note=c.name,actor=c.creator where id=lid;
 insert into redemption_private.claims(code_id,user_id,email,amount,ledger_id) values(c.id,uid,em,c.amount,lid);
 update redemption_private.codes set claimed=claimed+1 where id=c.id;
 return jsonb_build_object('ok',true,'amount',c.amount,'balance',acc.balance+c.amount,'unlimited',acc.unlimited,'ledgerId',lid,'name',c.name);
end $$;
revoke all on function redemption_private.redeem(text,boolean) from public,anon;
grant execute on function redemption_private.redeem(text,boolean) to authenticated;
create function public.points_redeem_code(p_code text,p_claim boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select redemption_private.redeem(p_code,p_claim); $$;
revoke all on function public.points_redeem_code(text,boolean) from public,anon;
grant execute on function public.points_redeem_code(text,boolean) to authenticated;

-- 收费功能按用户去重，API 操作结果与流水金额分别统计。
alter table usage_private.events drop constraint events_feature_check;
alter table usage_private.events add constraint events_feature_check check(feature in
 ('home','about','login','shortemotion','anomalies','technicalanalysis','sectorflow','etfflow','redemption','limitup','kandian','article','account','signin','points','settings','profile','invite','legal'));
create function usage_private.metrics()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t timestamptz:=public._sh_day_start(0); w timestamptz:=public._sh_day_start(6);
begin
 if not public._is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'balances',(select jsonb_build_object('accounts',count(*),'lt20',count(*) filter(where balance<20),
   'b20to49',count(*) filter(where balance>=20 and balance<50),'b50to99',count(*) filter(where balance>=50 and balance<100),
   'b100to199',count(*) filter(where balance>=100 and balance<200),'b200to499',count(*) filter(where balance>=200 and balance<500),
   'gte500',count(*) filter(where balance>=500)) from public.point_accounts where not unlimited),
  'paidFeatures',coalesce((select jsonb_agg(to_jsonb(r)) from (
   with features(key,feature,actions) as (values
    ('refresh','shortemotion',array['refresh']),('unlock','anomalies',array['unlock']),
    ('analysis','technicalanalysis',array['analysis_run','analysis_update']),('unlock_limitup','limitup',array['unlock']),
    ('unlock_sectorflow','sectorflow',array['unlock']),('unlock_etfflow','etfflow',array['unlock']))
   select f.key,
    count(distinct e.user_id) filter(where e.occurred_at>=t) as "requestsToday",
    count(distinct e.user_id) filter(where e.occurred_at>=t and e.outcome in ('success','partial')) as "successToday",
    count(distinct e.user_id) filter(where e.occurred_at>=t and e.outcome='failure') as "failureToday",
    count(distinct e.user_id) as "requests7d",
    count(distinct e.user_id) filter(where e.outcome in ('success','partial')) as "success7d",
    count(distinct e.user_id) filter(where e.outcome='failure') as "failure7d",
    count(distinct e.user_id) filter(where e.outcome='accepted') as "accepted7d"
   from features f left join usage_private.events e on e.feature=f.feature and e.action=any(f.actions) and e.source='api'
    and e.occurred_at>=w and e.outcome<>'skipped'
   group by f.key
  ) r),'[]'::jsonb),
  'spend7d',(select jsonb_build_object('users',count(distinct l.user_id),'points',coalesce(-sum(l.delta),0))
   from public.point_ledger l where l.created_at>=w and l.delta<0 and l.kind in ('refresh','unlock','analysis','unlock_limitup','unlock_sectorflow','unlock_etfflow')
    and not exists(select 1 from public.point_ledger r where r.ref=l.id and r.kind in ('refund','analysis_refund')))
 );
end $$;
revoke all on function usage_private.metrics() from public,anon;
grant execute on function usage_private.metrics() to authenticated;
create function public.admin_metrics()
returns jsonb language sql security invoker set search_path='' as $$ select usage_private.metrics(); $$;
revoke all on function public.admin_metrics() from public,anon;
grant execute on function public.admin_metrics() to authenticated;
