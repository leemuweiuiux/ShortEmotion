import { orderPattern, queryTrade, validMac } from "../_shared/ecpay-sandbox.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

function db(headers: HeadersInit, orderNo: string) {
  return new Request(supabaseUrl + "/rest/v1/ecpay_sandbox_orders?order_no=eq." + orderNo, { headers });
}

async function fulfill(orderNo: string, expectedTrade?: string, expectedAmount?: string) {
  if (!supabaseUrl || !serviceKey) throw new Error("Sandbox storage unavailable");
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
  const stored = await fetch(db(headers, orderNo));
  if (!stored.ok) throw new Error("Sandbox order lookup failed");
  const [order] = await stored.json();
  if (!order || (expectedAmount !== undefined && expectedAmount !== String(order.charge_twd))) return false;
  if (order.credited_at) return expectedTrade === undefined || order.trade_no === expectedTrade;

  const trade = await queryTrade(orderNo);
  if (trade.TradeStatus !== "1" || trade.SimulatePaid === "1") return false;
  if (trade.TradeAmt !== String(order.charge_twd) || !/^[A-Za-z0-9]{1,20}$/.test(trade.TradeNo || "") ||
      (expectedTrade !== undefined && expectedTrade !== trade.TradeNo)) return false;

  const updated = await fetch(db(headers, orderNo).url + "&credited_at=is.null", {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ trade_no: trade.TradeNo, credited_at: new Date().toISOString() })
  });
  if (!updated.ok) throw new Error("Sandbox credit update failed");
  return true;
}

async function recheck(request: Request, orderNo: string) {
  const authorization = request.headers.get("Authorization");
  if (!orderPattern.test(orderNo) || !authorization || !anonKey || !serviceKey) {
    return new Response("Order not found", { status: 404 });
  }
  // PostgREST validates the JWT and RLS restricts this read to the order owner.
  const visible = await fetch(db({ apikey: anonKey, Authorization: authorization }, orderNo));
  if (!visible.ok) return new Response("Order not found", { status: 404 });
  const [order] = await visible.json();
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.credited_at) return new Response("OK");
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
  const now = Date.now();
  // Let the provider finish processing and reserve a single recheck per minute.
  if (now - Date.parse(order.created_at) < 10 * 60_000) return new Response("Wait before checking", { status: 429 });
  const cutoff = encodeURIComponent(new Date(now - 60_000).toISOString());
  const lock = await fetch(db(headers, orderNo).url + "&credited_at=is.null&or=(checked_at.is.null,checked_at.lt." + cutoff + ")", {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ checked_at: new Date(now).toISOString() })
  });
  if (!lock.ok) throw new Error("Sandbox recheck could not be reserved");
  if (!(await lock.json()).length) return new Response("Wait before checking", { status: 429 });
  await fulfill(orderNo);
  return new Response("OK");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const orderNo = new URL(request.url).searchParams.get("order");
    if (orderNo) return await recheck(request, orderNo);
    const body = await request.text();
    if (body.length > 16_384) return new Response("Invalid callback", { status: 400 });
    const form = new URLSearchParams(body);
    const fields = Object.fromEntries(form);
    if (form.size !== Object.keys(fields).length || !orderPattern.test(fields.MerchantTradeNo || "") || !validMac(fields)) {
      return new Response("Invalid callback", { status: 400 });
    }
    if (fields.RtnCode !== "1" || fields.SimulatePaid === "1") return new Response("1|OK");
    if (!fields.TradeNo || !fields.TradeAmt || !(await fulfill(fields.MerchantTradeNo, fields.TradeNo, fields.TradeAmt))) {
      return new Response("Payment not confirmed", { status: 409 });
    }
    return new Response("1|OK");
  } catch (error) {
    console.error("ECPay sandbox callback", error instanceof Error ? error.message : String(error));
    return new Response("Retry later", { status: 503 });
  }
});
