// @vitest-environment node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("short-emotion data branch (file store → GitHub read store)", () => {
  const dir = mkdtempSync(join(tmpdir(), "short-emotion-data-"));
  let realFetch;

  beforeAll(() => {
    process.env.WIND_MOCK = "1";
    process.env.SHORT_EMOTION_STORE = "file";
    process.env.SHORT_EMOTION_DATA_DIR = dir;
    realFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    delete process.env.SHORT_EMOTION_STORE;
    delete process.env.SHORT_EMOTION_DATA_DIR;
  });

  it("the Actions job writes snapshots that the Vercel read API can serve", async () => {
    const { runScheduledRefresh, readResource } = await import("../api/_lib/short-emotion/service.js");
    // 固定在周三盘中：模拟行情的时间取自当前时钟，开盘前（集合竞价）跑会跳过情绪与题材
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T10:30:00+08:00"));
    let result;
    try {
      result = await runScheduledRefresh({ force: true });
    } finally {
      vi.useRealTimers();
    }
    expect(result.status).toBe("ok");

    // 板块资金：顺手记下的概念指数代码（不多调用 Wind）
    const codes = JSON.parse(readFileSync(join(dir, "kv", "sectorflow_concept-codes.json"), "utf8")).value;
    expect(codes.count).toBeGreaterThan(0);
    expect(codes.codes["8841416.WI"]).toMatchObject({ name: "人形机器人指数", firstSeen: "20261021", days: 1 });

    // 板块资金：跟着一起取（固定接口一次调用），盘中只存最新快照与盘中点，还没有收盘值
    expect(result.ran.some((item) => item.startsWith("sectorflow("))).toBe(true);
    expect(result.windCalls.byTool["index_data/get_index_price_indicators"]).toBeGreaterThanOrEqual(2);
    const flow = JSON.parse(readFileSync(join(dir, "kv", "sectorflow_latest.json"), "utf8")).value;
    expect(flow).toMatchObject({ tradingDate: "20261021", label: "10:30" });
    const boards = JSON.parse(readFileSync(join(dir, "kv", "sectorflow_boards.json"), "utf8")).value;
    expect(boards.day).toBe("20261021");
    expect(boards.boards.map((board) => board.name)).toContain("人形机器人"); // 名称去掉「指数」
    expect(flow.boards.length).toBe(boards.boards.length);
    const intraday = JSON.parse(readFileSync(join(dir, "kv", "sectorflow_intraday_20261021.json"), "utf8")).value;
    expect(intraday.points.map((point) => point.t)).toEqual(["10:30"]);

    // Vercel side: read-only store over raw.githubusercontent.com, served here from the same files.
    process.env.SHORT_EMOTION_STORE = "github";
    process.env.SHORT_EMOTION_DATA_URL = "https://raw.example/short-emotion-data";
    globalThis.fetch = async (url) => {
      const relative = String(url).replace("https://raw.example/short-emotion-data/", "");
      try {
        const body = readFileSync(join(dir, relative), "utf8");
        return new Response(body, { status: 200 });
      } catch {
        return new Response("not found", { status: 404 });
      }
    };

    const emotion = await readResource("emotion");
    expect(emotion.score).toBeGreaterThan(0);
    expect(emotion.storedAt).toBeTruthy();
    const anomalies = await readResource("anomalies");
    expect(Array.isArray(anomalies.items)).toBe(true);
    const history = await readResource("history");
    expect(history.history.length).toBeGreaterThan(0);
    const status = await readResource("status");
    expect(status.storage).toBe("github");
    expect(status.lastRun.status).toBe("ok");
  });

  it("the read-only store refuses writes", async () => {
    const { getStore } = await import("../api/_lib/short-emotion/store.js");
    process.env.SHORT_EMOTION_STORE = "github";
    await expect(getStore().kvSet("x", 1)).rejects.toThrow();
  });

  it("reads A股 from the data branch root", async () => {
    process.env.SHORT_EMOTION_STORE = "github";
    process.env.SHORT_EMOTION_DATA_URL = "https://raw.example/split";
    globalThis.fetch = async (url) => {
      const text = String(url);
      if (text.endsWith("/split/kv/emotion_latest.json")) return new Response(JSON.stringify({ value: { score: 42 } }), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const { getStore } = await import("../api/_lib/short-emotion/store.js");
    expect((await getStore("cn").kvGet("emotion:latest")).value.score).toBe(42);
  });

  it("daily averages only combine snapshots with the latest scoring method", async () => {
    process.env.SHORT_EMOTION_STORE = "file";
    const { getStore } = await import("../api/_lib/short-emotion/store.js");
    const store = getStore("cn");
    await store.historyUpsert({ tradingDate: "20260105", capturedAt: "2026-01-05T02:00:00Z", score: 20 }, true);
    await store.historyUpsert({ tradingDate: "20260105", capturedAt: "2026-01-05T02:30:00Z", scoreVersion: 2, score: 80 }, true);
    await store.historyUpsert({ tradingDate: "20260105", capturedAt: "2026-01-05T03:00:00Z", scoreVersion: 2, score: 90 }, true);
    expect((await store.dailyHistory()).find((item) => item.tradingDate === "20260105")).toMatchObject({
      scoreVersion: 2, score: 85, sampleCount: 2
    });
  });
});
