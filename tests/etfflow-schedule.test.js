import {it,expect,vi} from 'vitest';
import {scheduledMarketDate} from '../api/_lib/etf-flow/schedule.js';
import {collectSnapshot} from '../api/_lib/etf-flow/source.js';
it('晚间和次日盘前都归属同一交易日期，覆盖周五到周六及跨年',()=>{
 expect(scheduledMarketDate('35 12 * * 1-5',new Date('2026-11-06T12:35:00Z'))).toBe('20261106');
 expect(scheduledMarketDate('50 0 * * 2-6',new Date('2026-11-07T00:50:00Z'))).toBe('20261106');
 expect(scheduledMarketDate('50 0 * * 2-6',new Date('2027-01-01T00:50:00Z'))).toBe('20261231');
 expect(scheduledMarketDate('',new Date())).toBeNull();
 expect(()=>scheduledMarketDate('35 23 * * 0-4')).toThrow('未知ETF定时任务');
});
it('目标日无交易行情时不查询ETF名单或份额，不生成新快照',async()=>{
 const calendar={columns:[{name:'日期'}],rows:Array.from({length:25},(_,i)=>[`2026-09-${String(i+1).padStart(2,'0')}`])};
 const call=vi.fn(async()=>calendar);
 await expect(collectSnapshot(call,null,new Date('2026-10-01T12:35:00Z'),{requiredDate:'20261001'})).rejects.toMatchObject({code:'ETF_NO_TRADING_SESSION'});
 expect(call).toHaveBeenCalledTimes(1);expect(call.mock.calls[0].slice(0,2)).toEqual(['index_data','get_index_kline']);
});
