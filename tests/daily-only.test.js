import { describe, it, expect } from "vitest";
import {
  cleanDailyRows, cleanMinuteRows, isUsableDailyRows, isUsableMinuteRows,
  sameReferenceSession, buildDailyOnlyReport, latestDailyDay
} from "../api/_lib/technical-analysis/daily-only.js";

const bars = (size=130) => Array.from({length:size},(_,i)=>{
  const day = new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10);
  const p = 20+i*0.12;
  return {TIME:day+" 15:00:00",OPEN:p-0.1,MATCH:p,HIGH:p+0.3,LOW:p-0.4,
    VOLUME:10000+i,AVPRICE:p,CHANGEHANDRATE:1.3};
});
const minutes = (size=15,day="2026-10-27") =>
  Array.from({length:size},(_,i)=>({TIME:day+" 09:"+String(30+i).padStart(2,"0")+":00",MATCH:30+i*0.01}));

describe("个股盘前日 K 容错",()=>{
  it("过滤无效零价的日 K 与分时数据",()=>{
    expect(cleanDailyRows([...bars(20),{TIME:"2026-10-28",MATCH:0,HIGH:0,LOW:0}])).toHaveLength(20);
    expect(cleanMinuteRows([{TIME:"2026-10-27",MATCH:0},...minutes()])).toHaveLength(15);
    expect(isUsableDailyRows(bars(19))).toBe(false);
    expect(isUsableDailyRows(bars(20))).toBe(true);
    expect(isUsableMinuteRows(minutes(14))).toBe(false);
    expect(isUsableMinuteRows(minutes(15))).toBe(true);
  });
  it("分时必须与最新日 K 同一日期且不少于15个有效分钟",()=>{
    const day = [{TIME:"2026-10-27 15:00:00",OPEN:30,MATCH:30,HIGH:31,LOW:29}];
    expect(sameReferenceSession(minutes(),day)).toBe(true);
    expect(sameReferenceSession(minutes(14),day)).toBe(false);
    expect(sameReferenceSession(minutes(),[{...day[0],TIME:"2026-10-28 15:00:00"}])).toBe(false);
    expect(latestDailyDay(day)).toBe("2026-10-27");
  });
  it("不伪造分时图、胜率、赔率和结构失效价",()=>{
    const actual=bars(),result=buildDailyOnlyReport({stock:{code:"002472.SZ",name:"双环传动"},dailyRows:actual});
    expect(result.partial).toBe(true);
    expect(result.price).toBeCloseTo(actual.at(-1).MATCH,2);
    expect(result.referenceDate).toBe(actual.at(-1).TIME.slice(0,10));
    expect(result.daily).toHaveLength(120);
    expect(result.intraday).toHaveLength(0);
    expect(result.market).toHaveLength(0);
    expect(result.score).toBeNull();
    expect(result.opportunityScore).toBeNull();
    expect(result.buyValue.rr).toBe("—");
    expect(result.levels.some(x=>x[0]==="结构失效")).toBe(false);
  });
  it("缺少辅助指数时明确说明且不算相对强弱",()=>{
    const result=buildDailyOnlyReport({stock:{code:"002636.SZ",name:"金安国纪"},
      dailyRows:bars(),reason:"benchmark_unavailable"});
    expect(result.summary).toContain("指数基准数据暂不可用");
    expect(result.relative).toBe("—");
    expect(result.dataWarnings.join(" ")).toContain("胜率");
  });
  it("历史日 K 不够时拒绝生成，新股日 K 少于60根则不虚构MA60",()=>{
    expect(()=>buildDailyOnlyReport({stock:{code:"301001.SZ"},dailyRows:bars(19)})).toThrow(/历史日 K 数据不足/);
    const result=buildDailyOnlyReport({stock:{code:"301001.SZ"},dailyRows:bars(25)});
    expect(result.indicators.ma60).toBeNull();
    expect(result.summary).toContain("不足 60 根");
  });
});