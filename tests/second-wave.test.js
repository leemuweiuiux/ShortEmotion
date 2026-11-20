// 题材二波形态（api/_lib/second-wave/compute.js）：用合成日线验证分档与两项修正。
import { buildSecondWave, priorDryUp, summarizeSecondWave, candidatesOf } from "../api/_lib/second-wave/compute.js";

const TRADE = "2026-11-19";
function weekdays(end, count) {
  const days = [];
  const date = new Date(`${end}T00:00:00Z`);
  while (days.length < count) {
    if (date.getUTCDay() % 6 !== 0) days.unshift(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return days;
}
const CAL = weekdays(TRADE, 45);
/** amts：每日成交额（亿）；closes：每日收盘。 */
const bars = (amts, closes, days = CAL) => days.map((d, i) => ({ d, c: closes[i], amt: amts[i] }));
const flat = (value, n = CAL.length) => Array(n).fill(value);
const benchmark = { name: "万得全A", code: "881001.WI", chg: -0.5, amt: 10000, bars: bars(flat(10000), CAL.map((_, i) => 100 - i * 0.2)) };

// 第一波：窗口前段放量上涨，之后缩量横盘
function firstWaveThenDry() {
  const amts = CAL.map((_, i) => (i < 20 ? 20 : i < 26 ? 100 : Math.max(5, 70 - (i - 26) * 3.5)));
  const closes = CAL.map((_, i) => (i < 20 ? 100 : i < 26 ? 100 + (i - 19) * 3 : 118));
  return { amts, closes };
}

describe("题材二波形态", () => {
  it("第一波放量后缩量、比大盘抗跌：待确认", () => {
    const { amts, closes } = firstWaveThenDry();
    const data = buildSecondWave({ benchmark, tradeDate: TRADE, indices: [{ name: "缩量题材", code: "1.WI", bars: bars(amts, closes), snap: { chg: 0.1, mainNet: 1 } }] });
    expect(data.indices[0]).toMatchObject({ name: "缩量题材", band: "待确认" });
    expect(data.stats).toMatchObject({ total: 1, watch: 1 });
  });

  it("先缩量、再连续两日放量大涨：已启动", () => {
    const { amts, closes } = firstWaveThenDry();
    amts[amts.length - 2] = 90; amts[amts.length - 1] = 95;
    closes[closes.length - 2] = 120; closes[closes.length - 1] = 124;
    const data = buildSecondWave({ benchmark, tradeDate: TRADE, indices: [{ name: "二波", code: "2.WI", bars: bars(amts, closes), snap: { chg: 3.3 } }] });
    expect(data.indices[0].band).toBe("已启动");
    expect(data.indices[0].note).not.toContain("放量阶段");
  });

  it("没有先缩量的放量只算一波延续：观察", () => {
    const amts = CAL.map((_, i) => 20 + i * 2);
    const closes = CAL.map((_, i) => 100 + i);
    const data = buildSecondWave({ benchmark, tradeDate: TRADE, indices: [{ name: "一波", code: "3.WI", bars: bars(amts, closes), snap: { chg: 3 } }] });
    expect(data.indices[0].band).toBe("观察");
    expect(data.indices[0].note).toContain("放量前未出现明显缩量");
  });

  it("历史不足一个多月的指数不计算", () => {
    const short = CAL.slice(-15);
    const data = buildSecondWave({ benchmark, tradeDate: TRADE, indices: [
      { name: "新指数", code: "4.WI", bars: bars(flat(10, 15), flat(100, 15), short), snap: { chg: 1 } },
      { name: "老指数", code: "5.WI", ...(({ amts, closes }) => ({ bars: bars(amts, closes) }))(firstWaveThenDry()), snap: { chg: 0 } }
    ] });
    expect(data.indices.map((item) => item.name)).toEqual(["老指数"]);
    expect(data.meta.skipped).toEqual([{ name: "新指数", code: "4.WI", reason: "历史不足" }]);
    expect(data.stats.insufficient).toBe(1);
  });

  it("缩量判断只看最近 2 日之前的高峰", () => {
    expect(priorDryUp([100, 90, 50, 40, 40, 40, 40, 45, 90, 95].map((amt) => ({ amt }))).dry).toBe(true);
    expect(priorDryUp([20, 30, 40, 50, 60, 70, 80, 90, 95, 99].map((amt) => ({ amt }))).dry).toBe(false);
  });

  it("卡片摘要只带前 5 名、不带量能序列", () => {
    const { amts, closes } = firstWaveThenDry();
    const data = buildSecondWave({ benchmark, tradeDate: TRADE, indices: [{ name: "缩量题材", code: "1.WI", bars: bars(amts, closes), snap: { chg: 0.1 } }] });
    const summary = summarizeSecondWave(data);
    expect(summary.top).toHaveLength(1);
    expect(summary.top[0]).not.toHaveProperty("series");
    expect(summary.meta).not.toHaveProperty("skipped");
  });

  it("只看已启动与待确认：先已启动、再待确认，同档按总分", () => {
    const data = { indices: [
      { name: "a", band: "待确认", score: 70 }, { name: "b", band: "观察", score: 90 },
      { name: "c", band: "已启动", score: 50 }, { name: "d", band: "待确认", score: 80 }, { name: "e", band: "退潮", score: 99 }
    ] };
    expect(candidatesOf(data).map((x) => x.name)).toEqual(["c", "d", "a"]);
    expect(summarizeSecondWave({ meta: {}, stats: {}, indices: data.indices.map((x) => ({ ...x, series: [] })) }).top.map((x) => x.name)).toEqual(["c", "d", "a"]);
  });
});
