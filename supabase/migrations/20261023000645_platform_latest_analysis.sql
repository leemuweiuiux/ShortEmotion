-- 首页「大家都在看」：成功查询过的股票，同一股票去重，按全平台最新时间倒序取 3 条。
-- 只返回名称和带市场后缀的代码；不返回用户、历史记录 id、时间戳或分析结果。
-- 跨用户读取仅放在非暴露 schema；对外 RPC 用 invoker，不开放原表权限。
create schema if not exists analysis_private;
revoke all on schema analysis_private from public, anon;
grant usage on schema analysis_private to authenticated;

create or replace function analysis_private.latest_stocks()
returns table (code text, name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '28000'; end if;
  return query
    select r.code, r.name
    from (
      select distinct on (a.code) a.id, a.code, a.name, a.created_at
      from public.analysis_history a
      order by a.code, a.created_at desc, a.id desc
    ) r
    order by r.created_at desc, r.id desc
    limit 3;
end;
$$;
revoke all on function analysis_private.latest_stocks() from public, anon;
grant execute on function analysis_private.latest_stocks() to authenticated;

create or replace function public.analysis_latest()
returns table (code text, name text)
language sql
security invoker
set search_path = ''
as $$ select * from analysis_private.latest_stocks(); $$;
revoke all on function public.analysis_latest() from public, anon;
grant execute on function public.analysis_latest() to authenticated;
