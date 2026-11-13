import {it,expect,vi} from 'vitest';
import {scheduledMarketDate} from '../api/_lib/etf-flow/schedule.js';
import {collectSnapshot} from '../api/_lib/etf-flow/source.js';
it('晚间和次日盘前都归属同一交易日期，覆盖周五到周六及跨年',()=>{
 expect(scheduledMarketDate('35 12 * * 1-5',new Date('2026-11-06T12:35:00Z'))).toBe('20261106');
 expect(scheduledMarketDate('50 0 * * 2-6',new Date('2026-11-07T00:50:00Z'))).toBe('20261106');
 expect(scheduledMarketDate('50 0 * * 2-6',new Date('2027-01-01T00:50:00Z'))).toBe('20261231');
 expect(scheduledMarketDate('',new Date())).toBeNull();
 expect(()=>scheduledMarketDate('35 23 * * 0-4')).toThrow('未知ETF定时任务');
 // 2026-11-13：Supabase 准点主取 / 备援与新的后备 cron
 expect(scheduledMarketDate('primary',new Date('2026-11-13T13:00:00Z'))).toBe('20261113');
 expect(scheduledMarketDate('0 13 * * 1-5',new Date('2026-11-13T13:00:00Z'))).toBe('20261113');
 expect(scheduledMarketDate('backup',new Date('2026-11-14T00:30:00Z'))).toBe('20261113');
 expect(scheduledMarketDate('30 0 * * 2-6',new Date('2026-11-14T00:30:00Z'))).toBe('20261113');
});
it('GitHub 后备定时在目标日已完整发布时跳过，Supabase 主取与备援照常取数',async()=>{
 const {fallbackAlreadyDone}=await import('../api/_lib/etf-flow/schedule.js');
 const snapshot={dates:['20261112','20261113']};
 expect(fallbackAlreadyDone('github-schedule',snapshot,'20261113')).toBe(true);
 expect(fallbackAlreadyDone('github-schedule',snapshot,'20261114')).toBe(false);
 expect(fallbackAlreadyDone('workflow_dispatch',snapshot,'20261113')).toBe(false);
});
it('目标日无交易行情时不查询ETF名单或份额，不生成新快照',async()=>{
 const calendar={columns:[{name:'日期'}],rows:Array.from({length:25},(_,i)=>[`2026-09-${String(i+1).padStart(2,'0')}`])};
 const call=vi.fn(async()=>calendar);
 await expect(collectSnapshot(call,null,new Date('2026-10-01T12:35:00Z'),{requiredDate:'20261001'})).rejects.toMatchObject({code:'ETF_NO_TRADING_SESSION'});
 expect(call).toHaveBeenCalledTimes(1);expect(call.mock.calls[0].slice(0,2)).toEqual(['index_data','get_index_kline']);
});
