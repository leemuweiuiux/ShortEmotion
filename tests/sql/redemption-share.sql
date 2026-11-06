-- Run against a database with 20261105120000_redemption_share.sql applied. Fixtures and changes always roll back.
begin;
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
 ('10000000-0000-4000-8000-0000000000a1','admin-share-test@example.invalid',now(),now(),now()),
 ('10000000-0000-4000-8000-0000000000a2','new-share-test@example.invalid',now(),now(),now()),
 ('10000000-0000-4000-8000-0000000000a3','old-share-test@example.invalid',now()-interval '30 days',now()-interval '30 days',now());
insert into public.admin_users(user_id) values('10000000-0000-4000-8000-0000000000a1');
do $$
declare r jsonb; short text; old_code text;
begin
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-0000000000a1',true);
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-0000000000a1","name":"share short","mode":"unlimited","amount":50,"codeStyle":"short"}');
 assert (r->>'ok')::boolean, r::text; short:=r->'code'->>'code';
 assert short ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$', short;
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-0000000000a2","name":"share legacy","mode":"unlimited","amount":10}');
 assert r->'code'->>'code' ~ '^[A-F0-9]{20}$' and r->'code'->>'audience'='all', 'legacy default unchanged';
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-0000000000a3","name":"share custom","mode":"limited","maxClaims":2,"amount":20,"customCode":"zz-share-test-01","audience":"new","showCount":true}');
 assert (r->>'ok')::boolean and r->'code'->>'code'='ZZSHARETEST01', r::text;
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-0000000000a4","name":"dup","mode":"unlimited","amount":20,"customCode":"ZZSHARETEST01"}');
 assert r->>'reason'='code_taken', r::text;
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-0000000000a5","name":"invite-like","mode":"unlimited","amount":20,"customCode":"SEABCD23"}');
 assert r->>'reason'='bad_code', r::text;
 r:=public.admin_redemption('create','{"id":"20000000-0000-4000-8000-0000000000a6","name":"share old","mode":"unlimited","amount":30,"codeStyle":"short","audience":"old"}');
 old_code:=r->'code'->>'code';
 r:=public.admin_redemption('stats','{}'); assert (r->>'ok')::boolean, r::text;

 perform set_config('request.jwt.claim.sub','',true);
 r:=public.redemption_preview(left(short,4)||'-'||right(short,4));
 assert (r->>'ok')::boolean and (r->>'amount')::integer=50 and r->>'status'='active' and r->'claimed'='null'::jsonb, r::text;
 r:=public.redemption_preview('zzsharetest01'); assert (r->>'maxClaims')::integer=2 and r->>'audience'='new', r::text;

 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-0000000000a2',true);
 r:=public.points_redeem_code('ZZSHARETEST01',true); assert (r->>'ok')::boolean, r::text;
 r:=public.points_redeem_code('ZZSHARETEST01',true); assert r->>'reason'='already' and r->>'claimedAt' is not null, r::text;
 r:=public.points_redeem_code(old_code,true); assert r->>'reason'='audience_old', r::text;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-0000000000a3',true);
 r:=public.points_redeem_code('ZZSHARETEST01',true); assert r->>'reason'='audience_new', r::text;
 r:=public.points_redeem_code(old_code,true); assert (r->>'ok')::boolean, r::text;
end $$;
rollback;
