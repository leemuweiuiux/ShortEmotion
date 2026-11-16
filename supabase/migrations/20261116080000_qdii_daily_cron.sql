-- QDII 限额（2026-11-16）：Supabase 准点触发 .github/workflows/qdii.yml。时间为 UTC（北京时间 = UTC+8）。
--   北京时间周一至周六 08:20 主取、09:00 备援（备援在当天已取到最新纳指收盘时跳过 Wind 取数）
--   美股收盘在北京时间清晨，周二至周六更新纳指；周一主要核对周末发布的限额公告
select cron.schedule('shortemotion-qdii-primary', '20 0 * * 1-6', $$select private.shortemotion_dispatch('qdii-primary')$$);
select cron.schedule('shortemotion-qdii-backup', '0 1 * * 1-6', $$select private.shortemotion_dispatch('qdii-backup')$$);
