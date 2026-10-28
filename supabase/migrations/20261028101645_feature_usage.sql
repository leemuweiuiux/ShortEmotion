-- 全站功能统计：开始采集后生效；不回填或推测历史浏览行为。
create schema if not exists usage_private;
revoke all on schema usage_private from public;
grant usage on schema usage_private to anon, authenticated;
create table usage_private.started (id boolean primary key default true check(id), started_at timestamptz not null default now());
insert into usage_private.started default values;
create table usage_private.events (
  id uuid primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  user_id uuid references auth.users(id) on delete cascade,
  visitor_id uuid,
  feature text not null check(feature in ('home','about','login','shortemotion','anomalies','technicalanalysis','sectorflow','limitup','kandian','article','account','signin','points','settings','profile','invite','legal')),
  action text not null check(action ~ '^[a-z][a-z0-9_:-]{0,63}$'),
  source text not null check(source in ('browser','api')),
  outcome text not null check(outcome in ('observed','success','failure','partial','skipped','accepted')),
  check(user_id is not null or visitor_id is not null)
);
create index usage_events_time on usage_private.events(occurred_at desc);
create index usage_events_user_time on usage_private.events(user_id,occurred_at desc) where user_id is not null;
create index usage_events_visitor_time on usage_private.events(visitor_id,occurred_at desc) where visitor_id is not null;
alter table usage_private.events enable row level security;
alter table usage_private.started enable row level security;
revoke all on usage_private.events,usage_private.started from public,anon,authenticated;

create function usage_private.record(p_id uuid,p_feature text,p_action text,p_outcome text,p_source text,p_visitor uuid,p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); actor text;
begin
  if uid is null and p_visitor is null then return false; end if;
  -- API执行结果只接受服务器凭证，浏览器只能记录观察事件。复用现有cron服务凭证，不向浏览器暴露。
  if p_source='api' and (coalesce(p_token,'')='' or not exists(
    select 1 from vault.decrypted_secrets where name='shortemotion_cron_secret' and decrypted_secret=p_token
  )) then return false; end if;
  if p_source='browser' and (p_outcome<>'observed' or p_action !~ '^(page_view|click|submit|change)(:[a-z0-9_-]{1,48})?$') then return false; end if;
  actor := coalesce(uid::text,p_visitor::text);
  perform pg_advisory_xact_lock(hashtextextended(actor,0));
  if exists(select 1 from usage_private.events where id=p_id) then return true; end if;
  if (select count(*) from usage_private.events where occurred_at>now()-interval '1 minute' and
      ((uid is not null and user_id=uid) or (uid is null and visitor_id=p_visitor and user_id is null)))>=120 then return false; end if;
  insert into usage_private.events(id,user_id,visitor_id,feature,action,source,outcome)
    values(p_id,uid,p_visitor,p_feature,p_action,p_source,p_outcome);
  return true;
end $$;
revoke all on function usage_private.record(uuid,text,text,text,text,uuid,text) from public;
grant execute on function usage_private.record(uuid,text,text,text,text,uuid,text) to anon,authenticated;
create function public.usage_record(p_id uuid,p_feature text,p_action text,p_outcome text,p_source text,p_visitor uuid default null,p_token text default null)
returns boolean language sql security invoker set search_path='' as $$
  select usage_private.record(p_id,p_feature,p_action,p_outcome,p_source,p_visitor,p_token);
$$;
revoke all on function public.usage_record(uuid,text,text,text,text,uuid,text) from public;
grant execute on function public.usage_record(uuid,text,text,text,text,uuid,text) to anon,authenticated;

create function usage_private.overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today_start timestamptz:=public._sh_day_start(0); week_start timestamptz:=public._sh_day_start(6);
begin
  if not public._is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'startedAt',(select started_at from usage_private.started),
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.feature,r.source,r.action) from (
      select feature,action,source,
        count(*) filter(where occurred_at>=today_start) as today,
        count(distinct user_id) filter(where occurred_at>=today_start) as "usersToday",
        count(*) as week,count(distinct user_id) as "users7d",
        count(distinct visitor_id) filter(where user_id is null) as "anonymous7d",
        count(*) filter(where outcome='success') as success,
        count(*) filter(where outcome='failure') as failure,
        count(*) filter(where outcome='partial') as partial,
        count(*) filter(where outcome='skipped') as skipped,
        count(*) filter(where outcome='accepted') as accepted
      from usage_private.events where occurred_at>=week_start group by feature,action,source
    ) r),'[]'::jsonb),
    -- 旧版未保存全部发布凭据；历史卡片明确保留“未退款请求”口径，不冒充成功次数。
    'analyses', (select jsonb_build_object(
      'today',count(*) filter(where l.created_at>=today_start),
      'week',count(*),'users7d',count(distinct l.user_id))
      from public.point_ledger l where l.kind='analysis' and l.created_at>=week_start
      and not exists(select 1 from public.point_ledger r where r.ref=l.id and r.kind='analysis_refund')),
    'spend7d',(select jsonb_build_object('users',count(distinct l.user_id),'points',coalesce(-sum(l.delta),0))
      from public.point_ledger l where l.created_at>=week_start and l.delta<0
      and l.kind in ('refresh','unlock','analysis','unlock_limitup')
      and not exists(select 1 from public.point_ledger r where r.ref=l.id and r.kind in ('refund','analysis_refund')))
  );
end $$;
revoke all on function usage_private.overview() from public,anon;
grant execute on function usage_private.overview() to authenticated;
create function public.admin_usage()
returns jsonb language sql security invoker set search_path='' as $$ select usage_private.overview(); $$;
revoke all on function public.admin_usage() from public,anon;
grant execute on function public.admin_usage() to authenticated;

-- 原始使用事件与现有使用记录政策一致，保留30天。
select cron.schedule('usage-events-retention','17 19 * * *',
  $job$delete from usage_private.events where occurred_at < now()-interval '30 days'$job$);
