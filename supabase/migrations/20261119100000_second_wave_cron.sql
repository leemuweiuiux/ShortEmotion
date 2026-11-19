-- 题材二波（2026-11-19，先上 Exp）：Supabase 准点触发 .github/workflows/second-wave-exp.yml。时间为 UTC（北京时间 = UTC+8）。
--   北京时间周一至周五 16:10 主取、18:10 备援（备援在当天已有完整结果时跳过 Wind 取数）
select cron.schedule('shortemotion-second-wave-primary', '10 8 * * 1-5', $$select private.shortemotion_dispatch('second-wave-primary')$$);
select cron.schedule('shortemotion-second-wave-backup', '10 10 * * 1-5', $$select private.shortemotion_dispatch('second-wave-backup')$$);
