-- Run only after the migration has been approved and applied. All test mutations roll back.
begin;
do $$
declare uid uuid; old_balance integer; old_count bigint; first_result jsonb; second_result jsonb;
begin
 if has_function_privilege('anon','public.points_unlock_sectorflow()','execute') then raise exception 'anonymous execute must be revoked'; end if;
 if not has_function_privilege('authenticated','public.points_unlock_sectorflow()','execute') then raise exception 'authenticated wrapper unavailable'; end if;
 if (select prosecdef from pg_proc where oid='public.points_unlock_sectorflow()'::regprocedure) then raise exception 'public wrapper must be invoker'; end if;
 select user_id,balance into uid,old_balance from public.point_accounts where not unlimited and balance>=5 order by created_at limit 1 for update;
 if uid is null then raise exception 'no suitable account for rollback-only test'; end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 update public.point_accounts set sectorflow_unlock_until=null where user_id=uid;
 select count(*) into old_count from public.point_ledger where user_id=uid;
 first_result:=public.points_unlock_sectorflow();second_result:=public.points_unlock_sectorflow();
 if first_result->>'charged'<>'true' or (first_result->>'balance')::integer<>old_balance-5 then raise exception 'first unlock must debit exactly five'; end if;
 if second_result->>'charged'<>'false' or (second_result->>'balance')::integer<>old_balance-5 then raise exception 'repeat unlock must not debit'; end if;
 if (select count(*) from public.point_ledger where user_id=uid)<>old_count+1 then raise exception 'expected one ledger entry'; end if;
 update public.point_accounts set sectorflow_unlock_until=null,balance=4 where user_id=uid;
 if public.points_unlock_sectorflow()->>'ok'<>'false' then raise exception 'insufficient balance must fail'; end if;
 update public.point_accounts set unlimited=true where user_id=uid;
 if public.points_unlock_sectorflow()->>'charged'<>'false' then raise exception 'unlimited account must not debit'; end if;
end; $$;
rollback;
select 'sectorflow rollback tests passed' as result;
