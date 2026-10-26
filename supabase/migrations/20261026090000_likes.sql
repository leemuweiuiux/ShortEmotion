-- 点赞（2026-10-26 与产品确认）：用户发布的观点（kandian_views）与 Komidomi 的看点文章（早报、午间看点、收评）都能点赞。
-- 每人每篇只能赞一次，再点一次取消；可以给自己的观点点赞；只显示赞数，不公开是谁点的；不涉及积分。
--
-- 表不对 anon / authenticated 开放读写，只能经下面两个函数：
--   like_set(类型, 编号, 是否点赞)   设定本人对一篇内容的点赞状态（重复请求结果相同），返回最新赞数
--   like_summary(类型, 编号数组)     一次取多篇内容的赞数与本人是否已赞（列表页用，最多 60 篇）
-- 类型：view = 观点（编号是 kandian_views.id）；report = 看点文章（编号如 20261023、20261023-noon、20261023-evening）。
--
-- 在 Supabase → SQL Editor 执行一次（可重复执行）。

create table if not exists public.likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('view', 'report')),
  target_id text not null check (
    (target_type = 'view' and target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or (target_type = 'report' and target_id ~ '^[0-9]{8}(-noon|-evening)?$')
  ),
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index if not exists likes_target_idx on public.likes (target_type, target_id);
alter table public.likes enable row level security;
revoke all on table public.likes from public, anon, authenticated;

create or replace function public.like_set(p_type text, p_id text, p_liked boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_id text := lower(btrim(coalesce(p_id, '')));
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  if p_type = 'view' then
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.kandian_views where id = v_id::uuid) then
      raise exception 'Not found' using errcode = 'K4041';
    end if;
  elsif p_type = 'report' then
    if v_id !~ '^[0-9]{8}(-noon|-evening)?$' then raise exception 'Not found' using errcode = 'K4041'; end if;
  else
    raise exception 'Not found' using errcode = 'K4041';
  end if;

  if coalesce(p_liked, false) then
    insert into public.likes (user_id, target_type, target_id) values (uid, p_type, v_id) on conflict do nothing;
  else
    delete from public.likes where user_id = uid and target_type = p_type and target_id = v_id;
  end if;

  return jsonb_build_object(
    'liked', coalesce(p_liked, false),
    'count', (select count(*) from public.likes where target_type = p_type and target_id = v_id)
  );
end;
$$;

create or replace function public.like_summary(p_type text, p_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  if p_type not in ('view', 'report') or coalesce(cardinality(p_ids), 0) = 0 then return '{}'::jsonb; end if;
  if cardinality(p_ids) > 60 then raise exception 'too many ids' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_object_agg(t.id, jsonb_build_object('count', coalesce(c.n, 0), 'liked', coalesce(c.mine, false)))
    from (select distinct lower(x) as id from unnest(p_ids) as x) t
    left join (
      select l.target_id, count(*) as n, bool_or(l.user_id = uid) as mine
      from public.likes l
      where l.target_type = p_type and l.target_id = any (select lower(x) from unnest(p_ids) as x)
      group by l.target_id
    ) c on c.target_id = t.id
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.like_set(text, text, boolean), public.like_summary(text, text[]) from public, anon;
grant execute on function public.like_set(text, text, boolean), public.like_summary(text, text[]) to authenticated;
