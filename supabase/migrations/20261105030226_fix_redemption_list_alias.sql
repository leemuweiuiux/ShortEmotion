-- Avoid PL/pgSQL row-variable/table-alias ambiguity in the list query.
create or replace function redemption_private.admin(p_action text,p_payload jsonb)
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
   select code_entry.*, code_entry.claimed::bigint*code_entry.amount as issued,
    case when code_entry.disabled_at is not null then 'disabled' when code_entry.expires_at<=now() then 'expired'
     when code_entry.max_claims is not null and code_entry.claimed>=code_entry.max_claims then 'full' else 'active' end as status
   from redemption_private.codes code_entry where (v_filter is null or code_entry.name ilike '%'||v_filter||'%' or code_entry.code ilike '%'||replace(v_filter,'-','')||'%')
    and (nullif(p_payload->>'mode','') is null or code_entry.mode=p_payload->>'mode')
    and (v_before is null or code_entry.created_at<v_before)
    and (nullif(p_payload->>'status','') is null or (case when code_entry.disabled_at is not null then 'disabled' when code_entry.expires_at<=now() then 'expired' when code_entry.max_claims is not null and code_entry.claimed>=code_entry.max_claims then 'full' else 'active' end)=p_payload->>'status')
   order by code_entry.created_at desc limit 50
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
