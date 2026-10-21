-- 个股分析记录（2026-10-21 与产品确认）
--   每次个股技术分析成功后保存完整结果；首页、个股分析页显示「最近分析」3 条（同一支股票只留最新一次），
--   点开直接看当时的结果，不调用行情、不扣积分。
--   每人只保留最近 10 笔，更早的在保存时自动删除；只能通过下面的函数用本人凭证读写（只看得到自己的）。
-- 在 20261021_points_analysis.sql 之后，于 Supabase → SQL Editor 执行一次。

create table if not exists public.analysis_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,              -- 例如 603936.SH
  name text not null,              -- 例如 博敏电子
  result jsonb not null,           -- 完整分析结果（含分时、日 K，约 20KB）
  created_at timestamptz not null default now()
);
create index if not exists analysis_history_user_id_idx on public.analysis_history (user_id, id desc);

alter table public.analysis_history enable row level security;
revoke all on table public.analysis_history from anon, authenticated;

-- 保存一笔，并只保留本人最近 10 笔；返回新记录的 id
create or replace function public.analysis_save(p_code text, p_name text, p_result jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id bigint;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  if p_result is null or octet_length(p_result::text) > 500000 then raise exception 'result too large'; end if;
  insert into public.analysis_history (user_id, code, name, result)
  values (uid, left(btrim(p_code), 20), left(btrim(p_name), 40), p_result)
  returning id into new_id;
  delete from public.analysis_history h
  where h.user_id = uid
    and h.id not in (select k.id from public.analysis_history k where k.user_id = uid order by k.id desc limit 10);
  return new_id;
end;
$$;

-- 最近分析：同一支股票只取最新一次，按时间倒序（默认 3 条）
create or replace function public.analysis_recent(p_limit integer default 3)
returns table (id bigint, code text, name text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  return query
    select r.id, r.code, r.name, r.created_at
    from (
      select distinct on (a.code) a.id, a.code, a.name, a.created_at
      from public.analysis_history a
      where a.user_id = uid
      order by a.code, a.id desc
    ) r
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 3), 1), 10);
end;
$$;

-- 读取本人的一笔完整结果；不是本人的或已删除时返回 null
create or replace function public.analysis_get(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rec public.analysis_history;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  select * into rec from public.analysis_history a where a.id = p_id and a.user_id = uid;
  if rec.id is null then return null; end if;
  return jsonb_build_object('id', rec.id, 'code', rec.code, 'name', rec.name, 'createdAt', rec.created_at, 'result', rec.result);
end;
$$;

revoke all on function public.analysis_save(text, text, jsonb), public.analysis_recent(integer), public.analysis_get(bigint) from public, anon;
grant execute on function public.analysis_save(text, text, jsonb), public.analysis_recent(integer), public.analysis_get(bigint) to authenticated;
