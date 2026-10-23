create or replace function public.points_refund_analysis(p_ledger_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  acc public.point_accounts;
  charged integer;
  v_note text;
  refund_id bigint;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  acc := public._points_account(uid);
  select -l.delta, l.note into charged, v_note from public.point_ledger l
  where l.id = p_ledger_id and l.user_id = uid and l.kind = 'analysis' and l.created_at > now() - interval '10 minutes' for update;
  if exists(select 1 from analysis_private.used_analysis_charges u where u.ledger_id=p_ledger_id) then
    return jsonb_build_object('ok', false, 'balance', acc.balance);
  end if;
  if charged is null or charged <= 0 or exists (select 1 from public.point_ledger where ref = p_ledger_id and kind = 'analysis_refund') then
    return jsonb_build_object('ok', false, 'balance', acc.balance);
  end if;
  refund_id := public._points_change(uid, 'analysis_refund', charged, p_ledger_id);
  update public.point_ledger set note = v_note where id = refund_id;
  return jsonb_build_object('ok', true, 'balance', acc.balance + charged);
end;
$$;

-- 兼容部署切换前的旧 analysis_save 调用；有真实扣费才同步查看权和共用结果。
create function analysis_private.bridge_history_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare charge_id bigint;
begin
  if new.result->>'code' is distinct from new.code then return new; end if;
  select l.id into charge_id from public.point_ledger l
    where l.user_id=new.user_id and l.kind='analysis' and l.delta<=0
    and l.note=left(new.name || ' ' || new.code,40)
    and not exists(select 1 from analysis_private.used_analysis_charges u where u.ledger_id=l.id)
    and not exists(select 1 from public.point_ledger r where r.ref=l.id and r.kind='analysis_refund')
    order by l.id desc limit 1 for update;
  if charge_id is null then return new; end if;
  insert into analysis_private.used_analysis_charges values(charge_id,new.user_id) on conflict do nothing;
  if not found then return new; end if;
  insert into analysis_private.stock_access values(new.user_id,new.code) on conflict do nothing;
  insert into analysis_private.stock_latest values(new.code,new.name,new.result,clock_timestamp(),charge_id)
    on conflict(code) do update set name=excluded.name,result=excluded.result,updated_at=excluded.updated_at,source_ledger_id=excluded.source_ledger_id
    where excluded.source_ledger_id>analysis_private.stock_latest.source_ledger_id;
  return new;
end $$;
revoke all on function analysis_private.bridge_history_insert() from public,anon,authenticated;
create trigger analysis_history_shared_bridge after insert on public.analysis_history
for each row execute function analysis_private.bridge_history_insert();
-- 补齐两个迁移之间旧版写入的成功记录。
insert into analysis_private.stock_access select distinct user_id,code from public.analysis_history on conflict do nothing;
insert into analysis_private.stock_latest
select distinct on (code) code,name,result,created_at,0 from public.analysis_history order by code,created_at desc,id desc
on conflict(code) do update set name=excluded.name,result=excluded.result,updated_at=excluded.updated_at
where excluded.updated_at>analysis_private.stock_latest.updated_at;
