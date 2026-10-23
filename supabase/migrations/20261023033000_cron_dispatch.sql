-- 准点定时（2026-10-23 与产品确认：方案 A，闹钟用 Supabase）
--   GitHub Actions 自带的定时任务（schedule）常晚 25–30 分钟，每天还会整次丢掉约四分之一。
--   改由 Supabase Cron（pg_cron）按时用 pg_net 调用本站 /api/cron，接口再通过 GitHub API 手动运行工作流（立即排队）。
--   取数仍在 GitHub Actions 里跑、写 short-emotion-data 分支；工作流自带的定时任务保留作备用：
--   同一个 30 分钟时段只调用一次 Wind，早报同一天只生成一次，两边都触发也不会多花额度。
--
-- 时间表（北京时间，周一至周五；pg_cron 用 UTC，下面的 cron 表达式都是 UTC）：
--   短线情绪  09:02 盘前新闻；09:32–11:32、13:02–15:02 每 30 分钟（行情、题材、整点新闻、15:00 收盘清理）
--   早报      06:50
--   每个时点晚 2 分钟，留给 Wind 出齐 09:30 / 11:30 / 15:00 的数据；任务按实际开始时间归入时段（api/_lib/short-emotion/schedule.js）。
--   改时间时同步改 tests/cron.test.js。
--
-- 执行步骤（顺序不能反）：
--   1. 合并 PR，等 Vercel 部署好 /api/cron。
--   2. 在 Supabase → SQL Editor 执行下面两句（只执行一次）：生成随机密钥存进 Vault，再查出来。
--        select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'shortemotion_cron_secret');
--        select decrypted_secret from vault.decrypted_secrets where name = 'shortemotion_cron_secret';
--      把查到的值填到 Vercel 环境变量 CRON_SECRET（Production），然后 Redeploy 一次。密钥不要写进仓库。
--   3. 再执行本文件（可以重复执行：同名的定时会被覆盖，不会重复建立）。
--
-- 查看执行结果：
--   select j.jobname, d.start_time, d.status, d.return_message
--     from cron.job_run_details d join cron.job j using (jobid)
--     where j.jobname like 'shortemotion-%' order by d.start_time desc limit 20;
--   -- 网站的回应，202 = 已触发；只保留 6 小时
--   select id, status_code, content, error_msg, created from net._http_response order by created desc limit 10;
-- 停用（逐个名称）：select cron.unschedule('shortemotion-cn-am');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 只给定时任务用（private 不对外开放，访客与登录用户都不能调用）
create or replace function private.shortemotion_dispatch(p_job text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'shortemotion_cron_secret';
  if v_secret is null then
    raise exception 'Vault 里没有 shortemotion_cron_secret，请先按本文件开头的步骤 2 建立';
  end if;
  return net.http_post(
    url := 'https://www.lfjmwl.com/api/cron?job=' || p_job,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 15000
  );
end;
$$;
revoke all on function private.shortemotion_dispatch(text) from public, anon, authenticated;

-- 短线情绪：09:02、09:32 … 11:32
select cron.schedule('shortemotion-cn-am', '2,32 1-3 * * 1-5', $$select private.shortemotion_dispatch('short-emotion')$$);
-- 短线情绪：13:02、13:32、14:02、14:32
select cron.schedule('shortemotion-cn-pm', '2,32 5-6 * * 1-5', $$select private.shortemotion_dispatch('short-emotion')$$);
-- 短线情绪：15:02 收盘
select cron.schedule('shortemotion-cn-close', '2 7 * * 1-5', $$select private.shortemotion_dispatch('short-emotion')$$);
-- 早报：北京时间周一至周五 06:50（UTC 前一天 22:50）
select cron.schedule('shortemotion-morning-report', '50 22 * * 0-4', $$select private.shortemotion_dispatch('morning-report')$$);
