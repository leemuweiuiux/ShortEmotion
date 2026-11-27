-- 日频数据主取 + 备援（2026-11-13）：全部由 Supabase 准点触发；GitHub 自带定时（实测常晚约 1 小时）只作后备。
-- 时间为 UTC（北京时间 = UTC+8）。各任务在 api/_lib/short-emotion/github.js 的 SCHEDULED_JOBS。
--   涨停收盘明细备援   北京时间 16:35（主取为 15:35 最终更新）
--   板块资金历史补缺   北京时间 17:20 主取、18:20 备援
--   宽基 ETF          北京时间 21:00 主取、次日 08:30 备援（周五数据在周六备援）
--   全球联动          北京时间 08:10 主取、08:40 备援
select cron.schedule('shortemotion-cn-close-backup', '35 8 * * 1-5', $$select private.shortemotion_dispatch('short-emotion')$$);
select cron.schedule('shortemotion-sectorflow-history', '20 9 * * 1-5', $$select private.shortemotion_dispatch('sectorflow-history')$$);
select cron.schedule('shortemotion-sectorflow-history-backup', '20 10 * * 1-5', $$select private.shortemotion_dispatch('sectorflow-history')$$);
select cron.schedule('shortemotion-etf-primary', '0 13 * * 1-5', $$select private.shortemotion_dispatch('etf-flow-primary')$$);
select cron.schedule('shortemotion-etf-backup', '30 0 * * 2-6', $$select private.shortemotion_dispatch('etf-flow-backup')$$);
select cron.schedule('shortemotion-global-linkage', '10 0 * * 1-5', $$select private.shortemotion_dispatch('global-linkage')$$);
select cron.schedule('shortemotion-global-linkage-backup', '40 0 * * 1-5', $$select private.shortemotion_dispatch('global-linkage-backup')$$);
