-- 午间看点准点定时（2026-10-23 与产品确认）
--   北京时间周一至周五 11:40 调用 /api/cron?job=noon-report（UTC 03:40），由工作流 morning-report.yml 以 edition=noon 生成，12:00 起可见。
--   工作流自带 11:50、12:10 的备用定时；13:00 以后不再生成。
-- 依赖 20261023033000_cron_dispatch.sql（private.shortemotion_dispatch 与 Vault 密钥）。可以重复执行：同名定时会被覆盖。
-- 停用：select cron.unschedule('shortemotion-noon-report');
select cron.schedule('shortemotion-noon-report', '40 3 * * 1-5', $$select private.shortemotion_dispatch('noon-report')$$);
