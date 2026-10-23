-- 付费取得单只股票的查看权；任何已获权用户可免费查看平台最新结果，主动更新每次仍扣分。
create table analysis_private.stock_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  primary key (user_id, code)
);
create table analysis_private.stock_latest (
  code text primary key,
  name text not null,
  result jsonb not null,
  updated_at timestamptz not null,
  source_ledger_id bigint not null
);
create table analysis_private.used_analysis_charges (
  ledger_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table analysis_private.stock_access enable row level security;
alter table analysis_private.stock_latest enable row level security;
alter table analysis_private.used_analysis_charges enable row level security;
revoke all on analysis_private.stock_access, analysis_private.stock_latest, analysis_private.used_analysis_charges from public, anon, authenticated;
-- 迁移已有成功查询的查看权及最近结果。历史列表清理不会再删除查看权。
insert into analysis_private.stock_access select distinct user_id, code from public.analysis_history;
insert into analysis_private.stock_latest
select distinct on (code) code, name, result, created_at, id from public.analysis_history order by code, created_at desc, id desc;

create function analysis_private.publish(p_code text, p_name text, p_result jsonb, p_ledger_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); charge public.point_ledger; new_id bigint;
begin
  if uid is null then raise exception 'login required' using errcode='28000'; end if;
  if p_result is null or octet_length(p_result::text)>500000 or p_result->>'code' is distinct from p_code then raise exception 'invalid result'; end if;
  select * into charge from public.point_ledger l
    where l.id=p_ledger_id and l.user_id=uid and l.kind='analysis' and l.delta<=0
    and l.note=left(p_name || ' ' || p_code,40)
    and not exists(select 1 from public.point_ledger r where r.ref=l.id and r.kind='analysis_refund')
    for update;
  if charge.id is null then raise exception 'valid analysis charge required'; end if;
  -- 唯一键确保一笔扣费只可发布一次，不能通过旧扣费免费刷新／获得别的股票权限。
  insert into analysis_private.used_analysis_charges values(charge.id,uid);
  new_id := public.analysis_save(p_code,p_name,p_result);
  insert into analysis_private.stock_access values(uid,p_code) on conflict do nothing;
  insert into analysis_private.stock_latest values(p_code,p_name,p_result,clock_timestamp(),charge.id)
    on conflict(code) do update set name=excluded.name,result=excluded.result,updated_at=excluded.updated_at,source_ledger_id=excluded.source_ledger_id
    where excluded.source_ledger_id>analysis_private.stock_latest.source_ledger_id;
  return new_id;
end $$;
-- 回填时的 history id 与 ledger id 属于不同序列，以 0 标记旧结果，避免阻挡新结果。
update analysis_private.stock_latest set source_ledger_id=0;

create function analysis_private.shared(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'login required' using errcode='28000'; end if;
  return (select jsonb_build_object('code',s.code,'result',s.result,'updatedAt',s.updated_at)
    from analysis_private.stock_latest s
    join analysis_private.stock_access a on a.code=s.code and a.user_id=auth.uid()
    where s.code=p_code or split_part(s.code,'.',1)=p_code or s.name=p_code
    order by s.updated_at desc limit 1);
end $$;
create function analysis_private.catalog()
returns table(code text,name text,can_view boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'login required' using errcode='28000'; end if;
  return query select s.code,s.name,exists(select 1 from analysis_private.stock_access a where a.user_id=auth.uid() and a.code=s.code)
    from analysis_private.stock_latest s order by s.updated_at desc,s.code limit 3;
end $$;
revoke all on function analysis_private.publish(text,text,jsonb,bigint),analysis_private.shared(text),analysis_private.catalog() from public,anon;
grant execute on function analysis_private.publish(text,text,jsonb,bigint),analysis_private.shared(text),analysis_private.catalog() to authenticated;

create function public.analysis_publish(p_code text,p_name text,p_result jsonb,p_ledger_id bigint)
returns bigint language sql security invoker set search_path = '' as $$ select analysis_private.publish(p_code,p_name,p_result,p_ledger_id); $$;
create function public.analysis_shared(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$ select analysis_private.shared(p_code); $$;
create function public.analysis_catalog()
returns table(code text,name text,can_view boolean) language sql security invoker set search_path = '' as $$ select * from analysis_private.catalog(); $$;
revoke all on function public.analysis_publish(text,text,jsonb,bigint),public.analysis_shared(text),public.analysis_catalog() from public,anon;
grant execute on function public.analysis_publish(text,text,jsonb,bigint),public.analysis_shared(text),public.analysis_catalog() to authenticated;
