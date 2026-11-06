// @vitest-environment happy-dom
// 兑换码分享与领取：共用工具（找码、格式、文案）、后台小工具、公开预览接口、领取页流程、积分不足面板。
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { extractCode, displayCode, redeemLink, shareText, ruleChips, dateText, normalizeCode } from "../public/shared/redeem-code.js";
import { expiryValue, shanghaiIso, budgetText } from "../public/admin/redemption.js";
import { previewRedemption, redeemPoints, cleanCode, maskEmail } from "../api/_lib/redemption.js";
import { showPointsShortage } from "../public/shared/points-shortage.js";

const config = { url: "https://db.example.invalid", key: "public-key" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("兑换码格式与找码", () => {
  it("长码、短码分组显示，自定义口令原样", () => {
    expect(displayCode("abcd1234abcd1234abcd")).toBe("ABCD-1234-ABCD-1234-ABCD");
    expect(displayCode("hf7km2qx")).toBe("HF7K-M2QX");
    expect(displayCode("LFJ2026VIP")).toBe("LFJ2026VIP");
  });
  it("粘贴整段文案也能找出兑换码，不会误认品牌名", () => {
    const text = "【ShortEmotion】送你 50 积分 · 新功能体验奖励\n点击领取：https://www.lfjmwl.com/redeem?code=HF7KM2QX\n或输入 HF7K-M2QX";
    expect(extractCode(text)).toBe("HF7KM2QX");
    expect(extractCode("兑换码：hf7k-m2qx，快来领")).toBe("HF7KM2QX");
    expect(extractCode("  hf7k m2qx ")).toBe("HF7KM2QX");
    expect(extractCode("活动口令 LFJ2026 截止今晚")).toBe("LFJ2026");
    expect(extractCode("ShortEmotion 积分")).toBe("");
    expect(extractCode("")).toBe("");
  });
  it("领取链接用正式网址，文案链接单独一行并写明规则", () => {
    expect(redeemLink("hf7k-m2qx")).toBe("https://www.lfjmwl.com/redeem?code=HF7KM2QX");
    const text = shareText({ code: "HF7KM2QX", name: "体验奖励", amount: 50, mode: "limited", max_claims: 100, expires_at: null, audience: "new" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("【ShortEmotion】送你 50 积分 · 体验奖励");
    expect(lines[1]).toBe("点击领取：https://www.lfjmwl.com/redeem?code=HF7KM2QX");
    expect(lines[2]).toContain("HF7K-M2QX");
    expect(lines[3]).toBe("限前 100 名 · 新用户专享 · 长期有效 · 每人限领一次");
  });
  it("日期按北京时间显示，今年不写年份", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
    expect(dateText("2026-11-30T15:59:00Z")).toBe("11月30日 23:59");
    expect(dateText("2027-01-02T01:00:00Z")).toBe("2027年1月2日 09:00");
    expect(dateText(null)).toBe("");
    expect(ruleChips({ mode: "targeted", expiresAt: null, audience: "all" })).toEqual(["仅限受邀账号", "长期有效", "每人限领一次"]);
  });
});

describe("后台生成表单小工具", () => {
  it("截止快捷选项按北京时间算到 23:59，并按北京时间提交", () => {
    const now = new Date("2026-11-05T17:30:00Z"); // 北京时间 11 月 6 日 01:30
    expect(expiryValue("today", now)).toBe("2026-11-06T23:59");
    expect(expiryValue("7", now)).toBe("2026-11-13T23:59");
    expect(expiryValue("", now)).toBe("");
    expect(shanghaiIso("2026-11-13T23:59")).toBe("2026-11-13T15:59:00.000Z");
    expect(shanghaiIso("")).toBeNull();
  });
  it("发放上限：限制人数算总量，不限人数提示风险", () => {
    expect(budgetText({ mode: "limited", amount: 50, maxClaims: 100 })).toEqual({ text: "最多发出 100 人 × 50 分 = 5,000 分", warn: false });
    expect(budgetText({ mode: "targeted", amount: 20, emails: 3 }).text).toBe("最多发出 3 人 × 20 分 = 60 分");
    expect(budgetText({ mode: "unlimited", amount: 20, expiresAt: "" })).toMatchObject({ warn: true });
    expect(budgetText({ mode: "limited", amount: 0, maxClaims: 10 }).text).toBe("");
  });
});

describe("接口：公开预览与领取", () => {
  it("短码、口令、旧长码都接受；太短或带符号的不查数据库", () => {
    expect(cleanCode("hf7k-m2qx")).toBe("HF7KM2QX");
    expect(cleanCode("LFJ2026")).toBe("LFJ2026");
    expect(cleanCode("abcd-1234-abcd-1234-abcd")).toBe("ABCD1234ABCD1234ABCD");
    expect(cleanCode("AB12")).toBeNull();
    expect(cleanCode("AB12!@#")).toBeNull();
    expect(normalizeCode(" ab cd-12 ")).toBe("ABCD12");
  });
  it("公开预览用 Publishable key、不带用户凭证；已停用等状态附带说明", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, status: "expired", amount: 50, name: "x" }));
    vi.stubGlobal("fetch", fetch);
    const result = await previewRedemption(config, "hf7k-m2qx");
    expect(fetch.mock.calls[0][0]).toBe("https://db.example.invalid/rest/v1/rpc/redemption_preview");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ p_code: "HF7KM2QX" });
    expect(result).toMatchObject({ ok: true, status: "expired", message: "兑换码已过期" });
    expect((await previewRedemption(config, "bad")).reason).toBe("invalid");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("领取成功附带积分用途；领取对象不符给出明确说明", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, amount: 50, balance: 120 })));
    const ok = await redeemPoints(config, "token", "HF7KM2QX", true);
    expect(ok.uses.map((use) => use.href)).toContain("/technicalanalysis");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, reason: "audience_new" })));
    expect((await redeemPoints(config, "token", "HF7KM2QX", true)).message).toBe("这个兑换码仅限新用户（注册 7 天内）领取");
    expect(maskEmail("leemuwei@example.com")).toBe("le***@example.com");
  });
});

describe("领取页 /redeem", () => {
  function mountPage(url) {
    const html = readFileSync("public/redeem/index.html", "utf8");
    document.documentElement.innerHTML = html.replace(/<link[^>]*>/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    history.replaceState(null, "", url);
  }
  it("登录回来（claim=1）自动领取一次，显示到账与积分用途，并从网址去掉 claim", async () => {
    mountPage("/redeem?code=hf7k-m2qx&claim=1");
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      calls.push([String(url), options.method || "GET"]);
      if (String(url).includes("action=me")) return Response.json({ enabled: true, user: { email: "leemuwei@example.com" } });
      if (String(url).includes("redemption-preview")) return Response.json({ ok: true, code: "HF7KM2QX", name: "体验奖励", amount: 50, mode: "limited", audience: "all", status: "active", claimed: 3, maxClaims: 100, expiresAt: null });
      if (String(url).includes("redeem-points")) return Response.json({ ok: true, amount: 50, balance: 120, uses: [{ label: "个股技术分析", note: "每次分析", cost: 10, href: "/technicalanalysis" }] });
      return Response.json({});
    }));
    await import("../public/redeem/redeem.js?case=claim");
    await vi.waitFor(() => expect(document.querySelector("#done").hidden).toBe(false));
    expect(document.querySelector("#done-title").textContent).toBe("+50 积分已到账");
    expect(document.querySelector("#done-uses").textContent).toContain("个股技术分析");
    expect(calls.filter(([url]) => url.includes("redeem-points"))).toHaveLength(1);
    expect(location.search).toBe("");
  });
});

describe("积分不足面板", () => {
  it("算出还差多少，并给出签到、邀请、兑换三条路", () => {
    document.body.innerHTML = "";
    const close = showPointsShortage({ cost: 10, balance: 3 });
    const sheet = document.querySelector(".pts-sheet");
    expect(sheet.textContent).toContain("还差 7 积分");
    expect([...sheet.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/account/signin", "/account/invite", "/redeem"]);
    close();
    expect(document.querySelector(".pts-backdrop")).toBeNull();
  });
});
