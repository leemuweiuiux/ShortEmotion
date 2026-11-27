-- 早报准点备援（2026-11-27）
--   06:50 主取失败时，原来只靠 morning-report.yml 自带的 07:10 / 07:30 GitHub 定时补跑，
--   但 GitHub 定时实际晚了 5 小时以上（11/26、11/27 到 12:34、12:58 才跑，已开盘，补不了）。
--   改由 Supabase Cron 在北京时间周一至周五 07:10、07:30、08:40 准点再触发；本期已生成会直接跳过，不重复调用模型。
-- 依赖 20261023033000_cron_dispatch.sql（private.shortemotion_dispatch 与 Vault 密钥）。可以重复执行：同名定时会被覆盖。
-- 停用：select cron.unschedule('shortemotion-morning-report-backup'); select cron.unschedule('shortemotion-morning-report-last');
select cron.schedule('shortemotion-morning-report-backup', '10,30 23 * * 0-4', $$select private.shortemotion_dispatch('morning-report')$$);
select cron.schedule('shortemotion-morning-report-last', '40 0 * * 1-5', $$select private.shortemotion_dispatch('morning-report')$$);
