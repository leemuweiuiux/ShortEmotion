import { randomBytes } from "node:crypto";
import { authConfig, isSecureNodeRequest, resolveSession } from "./session.js";
import { checkoutUrl, orderPattern, packages, signedFields, taipeiTime } from "../../supabase/functions/_shared/ecpay-sandbox.mjs";

const origin = "https://exp.lfjmwl.com";
const host = new URL(origin).host;
const purchasePath = "/account/buy-points";
const orders = "/rest/v1/ecpay_sandbox_orders";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers?.host !== host || process.env.VERCEL_ENV === "production") return res.status(404).json({ error: "页面不存在" });
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "请求方式无效" });
  if (req.method === "POST" && req.headers?.origin !== origin) return res.status(403).json({ error: "请求来源无效" });
  const config = authConfig();
  if (!config) return res.status(503).json({ error: "登录服务暂时不可用" });

  try {
    const session = await resolveSession(req.headers.cookie, { config, secure: isSecureNodeRequest(req), clearOnFailure: false });
    if (session.setCookies.length) res.setHeader("Set-Cookie", session.setCookies);
    if (!session.user || !session.accessToken) return res.status(401).json({ error: "请先登录", code: "login_required" });
    const headers = { apikey: config.key, Authorization: "Bearer " + session.accessToken };
    const callback = config.url + "/functions/v1/ecpay-sandbox-callback";

    const recheck = req.method === "POST" && req.query?.recheck === "1";
    if (req.method === "POST" && !recheck) {
      const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(String(req.body || "{}"));
      const pack = packages.find(({ points }) => points === body?.points);
      if (!pack) return res.status(400).json({ error: "请选择有效的积分方案" });
      const orderNo = "SE" + randomBytes(9).toString("hex").toUpperCase();
      const saved = await fetch(config.url + orders, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ order_no: orderNo, points: pack.points, price_cny: pack.priceCny, charge_twd: pack.chargeTwd }),
        signal: AbortSignal.timeout(6000)
      });
      if (!saved.ok) throw new Error("Sandbox order insert failed (" + saved.status + ")");
      return res.status(201).json({
        checkoutUrl,
        fields: signedFields({
          MerchantTradeNo: orderNo,
          MerchantTradeDate: taipeiTime(),
          PaymentType: "aio",
          TotalAmount: String(pack.chargeTwd),
          TradeDesc: "Market Emotion ECPay Sandbox",
          ItemName: "Market Emotion " + pack.points + " Test Points",
          ReturnURL: callback,
          ClientBackURL: origin + purchasePath + "?order=" + orderNo,
          ChoosePayment: "Credit",
          EncryptType: "1"
        })
      });
    }

    const orderNo = req.query?.order;
    if ((orderNo !== undefined || recheck) && (typeof orderNo !== "string" || !orderPattern.test(orderNo))) return res.status(400).json({ error: "订单号无效" });
    if (recheck) {
      const checked = await fetch(callback + "?order=" + orderNo, {
        method: "POST", headers, signal: AbortSignal.timeout(10_000)
      });
      if (!checked.ok) return res.status(checked.status).json({
        error: checked.status === 429 ? "请稍后再查询这笔订单" : "暂时无法确认付款，请稍后再试"
      });
    }
    const params = new URLSearchParams({
      select: "order_no,points,price_cny,charge_twd,created_at,credited_at",
      order: "created_at.desc",
      limit: "20"
    });
    if (orderNo) params.set("order_no", "eq." + orderNo);
    const result = await fetch(config.url + orders + "?" + params, { headers, signal: AbortSignal.timeout(6000) });
    if (!result.ok) throw new Error("Sandbox order read failed (" + result.status + ")");
    const history = await result.json();
    if (orderNo && !history.length) return res.status(404).json({ error: "当前账号找不到这笔订单" });
    return res.status(200).json({ email: session.user.email, packages, history });
  } catch (error) {
    console.error("ECPay sandbox", error.message);
    return res.status(error instanceof SyntaxError ? 400 : 503).json({ error: "测试收款暂时无法处理，请稍后再试" });
  }
}
