import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { checkMac, signedFields } from "../supabase/functions/_shared/ecpay-sandbox.mjs";

const database = "https://example.supabase.co";
const store = database + "/rest/v1/ecpay_sandbox_orders";
const orderNo = "SE123456789012345678";
vi.mock("../api/_lib/session.js", () => ({
  authConfig: () => ({ url: "https://example.supabase.co", key: "publishable-key" }),
  resolveSession: async (cookie) => cookie
    ? { user: { email: "test@example.com" }, accessToken: "session-token", setCookies: [] }
    : { user: null, setCookies: [] },
  isSecureNodeRequest: () => true
}));

import handler from "../api/ecpay-sandbox.js";

async function call(options = {}) {
  const response = { setHeader: vi.fn(), status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({
    method: "GET",
    headers: { host: "exp.lfjmwl.com", cookie: "session", origin: "https://exp.lfjmwl.com" },
    ...options
  }, response);
  return response;
}

test("reproduces ECPay's published SHA256 checkout signature", () => {
  expect(checkMac({
    TradeDesc: "促銷方案", PaymentType: "aio", MerchantTradeDate: "2023/03/12 15:30:23",
    MerchantTradeNo: "ecpay20230312153023", MerchantID: "3002607", ReturnURL: "https://www.ecpay.com.tw/receive.php",
    ItemName: "Apple iphone 15", TotalAmount: "30000", ChoosePayment: "ALL", EncryptType: "1"
  })).toBe("6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840");
});

test("locks the server's RMB and sandbox TWD amounts before signing checkout", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  const response = await call({ method: "POST", body: { points: 240, priceCny: 1, chargeTwd: 1 } });
  expect(response.code).toBe(201);
  expect(response.body.checkoutUrl).toBe("https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5");
  const fields = response.body.fields;
  expect(fields.TotalAmount).toBe("225");
  expect(fields.CheckMacValue).toBe(checkMac(fields));
  expect(fields.ClientBackURL).toContain(fields.MerchantTradeNo);
  expect(fields.ReturnURL).toBe(database + "/functions/v1/ecpay-sandbox-callback");
  const [url, request] = fetch.mock.calls[0];
  expect(url).toBe(store);
  expect(request.headers.Authorization).toBe("Bearer session-token");
  expect(JSON.parse(request.body)).toEqual({
    order_no: fields.MerchantTradeNo, points: 240, price_cny: 50, charge_twd: 225
  });
});

test("only accepts checkout from a signed-in user on the test site", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await call({ headers: { host: "www.lfjmwl.com" } })).code).toBe(404);
  expect((await call({ method: "POST", headers: { host: "exp.lfjmwl.com", origin: "https://other.example" } })).code).toBe(403);
  expect((await call({ headers: { host: "exp.lfjmwl.com" } })).code).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

let callback;
beforeEach(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (key) => ({ SUPABASE_URL: database, SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "anon" })[key] },
    serve: (handler) => { callback = handler; }
  });
  vi.resetModules();
  await import("../supabase/functions/ecpay-sandbox-callback/index.ts");
});
afterEach(() => vi.unstubAllGlobals());

function notification(overrides = {}, signed = true) {
  const fields = { MerchantTradeNo: orderNo, TradeNo: "2026110810001", TradeAmt: "45", RtnCode: "1", SimulatePaid: "0", ...overrides };
  return new Request("https://example.supabase.co/functions/v1/ecpay-sandbox-callback", {
    method: "POST",
    body: new URLSearchParams(signed ? signedFields(fields) : fields)
  });
}

test("rejects an unsigned callback and acknowledges simulated payment without crediting", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await callback(notification({}, false))).status).toBe(400);
  expect(await (await callback(notification({ SimulatePaid: "1" }))).text()).toBe("1|OK");
  expect(fetch).not.toHaveBeenCalled();
});

test("credits only after a matching provider query and tolerates delivery retries", async () => {
  const order = { charge_twd: 45, credited_at: null, trade_no: null };
  let updates = 0;
  let amount = "46";
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const href = url instanceof Request ? url.url : url;
    if (href.startsWith(store)) {
      if (options?.method === "PATCH") {
        expect(href).toContain("&credited_at=is.null");
        Object.assign(order, JSON.parse(options.body));
        updates += 1;
        return new Response(null, { status: 204 });
      }
      return Response.json([order]);
    }
    expect(href).toBe("https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5");
    return new Response(new URLSearchParams(signedFields({
      MerchantTradeNo: orderNo, TradeNo: "2026110810001", TradeAmt: amount, TradeStatus: "1"
    })));
  }));
  expect((await callback(notification())).status).toBe(409);
  expect(updates).toBe(0);
  amount = "45";
  expect(await (await callback(notification())).text()).toBe("1|OK");
  expect(await (await callback(notification())).text()).toBe("1|OK");
  expect(updates).toBe(1);
});
