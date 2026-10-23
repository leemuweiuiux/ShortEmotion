-- Trusted server mutations: users may read the feed but cannot forge a price or rewrite a published judgment.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.kandian_writer (id boolean primary key default true check(id), token_hash text not null);
alter table private.kandian_writer enable row level security;
revoke all on private.kandian_writer from public, anon, authenticated;

create table public.kandian_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  author text not null,
  code text not null check(code ~ '^[0-9]{6}\.(SH|SZ|BJ)$'),
  name text not null check(length(name) between 1 and 50),
  direction text not null check(direction in ('bullish','bearish','neutral')),
  horizon integer not null check(horizon in (5,10,20,60)),
  tags text[] not null check(cardinality(tags) between 1 and 3),
  note text not null default '' check(length(note)<=200),
  price numeric not null check(price>0 and price<'Infinity'::numeric),
  quote_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'active' check(status in ('active','closed')),
  closed_at timestamptz,
  close_price numeric check(close_price>0 and close_price<'Infinity'::numeric),
  close_quote_at timestamptz,
  unique(user_id,request_id),
  check((status='active' and closed_at is null and close_price is null and close_quote_at is null) or
        (status='closed' and closed_at is not null and close_price is not null and close_quote_at is not null))
);
create index kandian_views_feed on public.kandian_views(created_at desc,id desc);
create index kandian_views_owner on public.kandian_views(user_id,created_at desc);
alter table public.kandian_views enable row level security;
revoke all on public.kandian_views from public,anon,authenticated;
grant select on public.kandian_views to authenticated;
create policy "Signed in users read published views" on public.kandian_views for select to authenticated using(true);

create function public.kandian_publish(p_view jsonb, p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); result public.kandian_views; qt timestamptz;
begin
  if uid is null or not exists(select 1 from private.kandian_writer where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select * into result from public.kandian_views where user_id=uid and request_id=(p_view->>'request_id')::uuid;
  if found then return to_jsonb(result); end if;
  if (select count(*) from public.kandian_views where user_id=uid and created_at>now()-interval '1 day')>=30 then
    raise exception 'Publish limit reached' using errcode='K4001';
  end if;
  qt := (p_view->>'quote_at')::timestamptz;
  if qt < now()-interval '2 minutes' or qt > now()+interval '10 seconds' then raise exception 'Stale quote'; end if;
  insert into public.kandian_views(user_id,request_id,author,code,name,direction,horizon,tags,note,price,quote_at)
  values(uid,(p_view->>'request_id')::uuid,'用户'||left(replace(uid::text,'-',''),8),p_view->>'code',p_view->>'name',p_view->>'direction',
    (p_view->>'horizon')::integer,array(select jsonb_array_elements_text(p_view->'tags')),p_view->>'note',(p_view->>'price')::numeric,qt)
  returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.kandian_publish(jsonb,text) from public,anon;
grant execute on function public.kandian_publish(jsonb,text) to authenticated;

create function public.kandian_close(p_id uuid,p_price numeric,p_quote_at timestamptz,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result public.kandian_views;
begin
  if uid is null or not exists(select 1 from private.kandian_writer where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_quote_at < now()-interval '2 minutes' or p_quote_at>now()+interval '10 seconds' then raise exception 'Stale quote'; end if;
  update public.kandian_views set status='closed',closed_at=clock_timestamp(),close_price=p_price,close_quote_at=p_quote_at
  where id=p_id and user_id=uid and status='active' returning * into result;
  if not found then raise exception 'Not found' using errcode='K4004'; end if;
  return to_jsonb(result);
end $$;
revoke all on function public.kandian_close(uuid,numeric,timestamptz,text) from public,anon;
grant execute on function public.kandian_close(uuid,numeric,timestamptz,text) to authenticated;
