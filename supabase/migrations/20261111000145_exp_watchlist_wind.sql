-- Wind MCP publications update forecasts and outcomes in the same transaction.
grant update on public.exp_watchlist_forecasts, public.exp_watchlist_outcomes to service_role;
create or replace function public.exp_watchlist_publish(p_forecasts jsonb, p_outcomes jsonb, p_replace boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(20261111, 2005);
  insert into public.exp_watchlist_forecasts(user_id,source_day,picks,published_at)
  select user_id,source_day,picks,now() from jsonb_to_recordset(p_forecasts)
    as x(user_id uuid,source_day date,picks jsonb)
  on conflict (user_id,source_day) do update
    set picks=excluded.picks,published_at=excluded.published_at where p_replace;
  insert into public.exp_watchlist_outcomes(user_id,source_day,direction,result)
  select user_id,source_day,direction,result from jsonb_to_recordset(p_outcomes)
    as x(user_id uuid,source_day date,direction text,result jsonb)
  on conflict (user_id,source_day,direction) do update
    set result=excluded.result where p_replace;
end;
$$;
revoke all on function public.exp_watchlist_publish(jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.exp_watchlist_publish(jsonb,jsonb,boolean) to service_role;
select cron.alter_job(jobid, schedule := '5 12 * * 1-5')
from cron.job where jobname='exp-watchlist-daily';
