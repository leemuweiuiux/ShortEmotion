-- Run against a database with the migration applied. Fixtures and changes always roll back.
begin;
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
 ('10000000-0000-4000-8000-000000000001','admin-redemption-test@example.invalid',now(),now(),now()),
 ('10000000-0000-4000-8000-000000000002','user-redemption-test@example.invalid',now(),now(),now()),
 ('10000000-0000-4000-8000-000000000003','other-redemption-test@example.invalid',now(),now(),now());
insert into public.admin_users(user_id) values('10000000-0000-4000-8000-000000000001');
do $$
declare r jsonb; code1 text; code2 text; code3 text; lid bigint; n integer; m jsonb; baseline jsonb;
begin
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-000000000001","name":"test limited","mode":"limited","amount":100,"maxClaims":1,"showCount":true}');
 assert (r->>'ok')::boolean, r::text; code1:=r->'code'->>'code';
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-000000000001","name":"test limited","mode":"limited","amount":100,"maxClaims":1}');
 assert r->'code'->>'code'=code1,'idempotent create';
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-000000000002","name":"test targeted","mode":"targeted","amount":200,"emails":["USER-REDEMPTION-TEST@example.invalid"," user-redemption-test@example.invalid "]}');
 assert (r->>'ok')::boolean, r::text; code2:=r->'code'->>'code'; assert (r->'code'->>'max_claims')::integer=1;
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-000000000003","name":"test unlimited","mode":"unlimited","amount":50}');
 assert (r->>'ok')::boolean, r::text; code3:=r->'code'->>'code';
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-000000000004","name":"bad","mode":"unlimited","amount":1001}'); assert r->>'reason'='bad_input';
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
 r:=public.points_redeem_code(code1,false); assert (r->>'claimed')::integer=0 and (r->>'maxClaims')::integer=1;
 assert not exists(select 1 from public.point_ledger where kind='redemption' and user_id=auth.uid()),'preview never credits';
 r:=public.points_redeem_code(lower(code1),true); assert (r->>'ok')::boolean and (r->>'balance')::integer=150,r::text; lid:=(r->>'ledgerId')::bigint;
 assert exists(select 1 from public.point_ledger where id=lid and kind='redemption' and delta=100 and note='test limited');
 r:=public.points_redeem_code(code1,true); assert r->>'reason'='already';
 r:=public.points_redeem_code(code2,true); assert (r->>'ok')::boolean and (r->>'balance')::integer=350,r::text;
 r:=public.points_redeem_code(code3,false); assert (r->>'ok')::boolean and r->>'maxClaims' is null;
 r:=public.points_redeem_code(code3,true); assert (r->>'ok')::boolean and (r->>'balance')::integer=400,r::text;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 r:=public.points_redeem_code(code1,true); assert r->>'reason'='full';
 r:=public.points_redeem_code(code2,true); assert r->>'reason'='ineligible';
 begin perform public.admin_redemption('list','{}'); raise exception 'non-admin was allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_metrics(); raise exception 'non-admin metrics allowed'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 r:=public.admin_redemption('detail','{"id":"20000000-0000-4000-8000-000000000002"}'); assert jsonb_array_length(r->'claims')=1 and (r->'targets'->0->>'claimed')::boolean;
 r:=public.admin_redemption('disable','{"id":"20000000-0000-4000-8000-000000000003"}'); assert (r->>'ok')::boolean;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 r:=public.points_redeem_code(code3,true); assert r->>'reason'='disabled';
 update redemption_private.codes set disabled_at=null,expires_at=now()-interval '1 minute' where code=code3;
 r:=public.points_redeem_code(code3,true); assert r->>'reason'='expired';
 update auth.users set email_confirmed_at=null where id=auth.uid();
 r:=public.points_redeem_code(code3,true); assert r->>'reason'='unverified';
 update auth.users set email_confirmed_at=now() where id=auth.uid();
 for n in 1..21 loop r:=public.points_redeem_code('00000000000000000000',false); end loop;
 assert r->>'reason'='rate_limit';
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 select value into baseline from jsonb_array_elements(public.admin_metrics()->'paidFeatures') where value->>'key'='unlock_etfflow';
 insert into usage_private.events(id,user_id,feature,action,source,outcome) values
  (gen_random_uuid(),'10000000-0000-4000-8000-000000000002','etfflow','unlock','api','success'),
  (gen_random_uuid(),'10000000-0000-4000-8000-000000000002','etfflow','unlock','api','success'),
  (gen_random_uuid(),'10000000-0000-4000-8000-000000000002','etfflow','unlock','api','failure'),
  (gen_random_uuid(),'10000000-0000-4000-8000-000000000003','etfflow','unlock','api','failure'),
  (gen_random_uuid(),'10000000-0000-4000-8000-000000000001','etfflow','unlock','api','skipped'),
  (gen_random_uuid(),'10000000-0000-4000-8000-000000000001','etfflow','click:unlock','browser','observed');
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 m:=public.admin_metrics();
 select value into r from jsonb_array_elements(m->'paidFeatures') where value->>'key'='unlock_etfflow';
 assert (r->>'requestsToday')::integer=(baseline->>'requestsToday')::integer+2 and (r->>'successToday')::integer=(baseline->>'successToday')::integer+1 and (r->>'failureToday')::integer=(baseline->>'failureToday')::integer+2, r::text;
 select sum(value::integer) into n from jsonb_each_text(m->'balances') where key<>'accounts';
 assert n=(m->'balances'->>'accounts')::integer,'bucket partition';
 assert not has_function_privilege('anon','public.points_redeem_code(text,boolean)','execute');
 assert not has_table_privilege('authenticated','redemption_private.codes','select');
end $$;
select 'redemption, authorization, ledger, deduplication and balance partition checks passed' as verification;

rollback;
