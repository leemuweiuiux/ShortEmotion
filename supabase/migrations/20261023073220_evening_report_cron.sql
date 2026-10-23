-- 在晚报代码合并部署后执行。北京时间周一至周五16:05，UTC08:05。
-- 同名任务重复执行只更新，不会创建重复任务；休市由生成脚本检查当日收盘快照后跳过。
select cron.schedule('shortemotion-evening-report', '5 8 * * 1-5', $$select private.shortemotion_dispatch('evening-report')$$);
