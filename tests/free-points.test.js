// 2026-11-19 解除积分限制：默认（未设 SE_POINTS_MODE=paid）时看资料类解锁免费、刷新不扣分、个股分析每天 10 次。
import { vi } from "vitest";

async function freeModules() {
  vi.resetModules();
  vi.stubEnv("SE_POINTS_MODE", "");
  return {
    points: await import("../api/_lib/points.js"),
    sectorflow: await import("../api/_lib/sectorflow/access.js"),
    etf: await import("../api/_lib/etf-flow/access.js"),
    limitup: await import("../api/_lib/limitup/handler.js")
  };
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("免费模式（解除积分限制）", () => {
  it("默认免费；SE_POINTS_MODE=paid 时恢复扣分", async () => {
    const { points } = await freeModules();
    expect(points).toMatchObject({ FREE_VIEWING: true, FREE_REFRESH: true, FREE_ANALYSIS: true, ANALYSIS_DAILY_LIMIT: 10 });
    vi.resetModules();
    vi.stubEnv("SE_POINTS_MODE", "paid");
    const paid = await import("../api/_lib/points.js");
    expect(paid).toMatchObject({ FREE_VIEWING: false, FREE_REFRESH: false, FREE_ANALYSIS: false });
  });

  it("资金流向、宽基ETF、涨停情绪：登录用户直接解锁，不查积分", async () => {
    const { sectorflow, etf, limitup } = await freeModules();
    const status = vi.fn(async () => { throw new Error("不应查询积分"); });
    const session = { enabled: true, accessToken: "token" };
    expect(await sectorflow.sectorflowAccess(session, { status })).toMatchObject({ locked: false, unavailable: false });
    expect(await etf.etfflowAccess(session, { status })).toMatchObject({ locked: false, unavailable: false });
    expect(await limitup.unlockState(session, { status })).toMatchObject({ unlocked: true, unavailable: false });
    expect(status).not.toHaveBeenCalled();
  });

  it("个股分析次数用完的提示", async () => {
    const { points } = await freeModules();
    const error = new points.AnalysisQuotaError(10);
    expect(error).toMatchObject({ code: "analysis_quota", statusCode: 429, used: 10, limit: 10 });
    expect(error.message).toBe("今天的 10 次个股分析已用完，明天再来");
  });
});
