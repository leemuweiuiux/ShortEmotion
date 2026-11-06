-- 北京时间交易日15:35再次全量重算；保留15:02收盘更新。
select cron.schedule('shortemotion-cn-final', '35 7 * * 1-5', $$select private.shortemotion_dispatch('short-emotion')$$);
