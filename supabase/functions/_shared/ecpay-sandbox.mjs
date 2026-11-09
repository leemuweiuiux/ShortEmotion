import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// ECPay's published AIO sandbox fixtures. Only payment-stage.ecpay.com.tw is used.
const merchantId = "3002607";
const hashKey = "pwFHCqoQZGmho4w6";
const hashIv = "EkRm7iFT261dpevs";
const gateway = "https://payment-stage.ecpay.com.tw";
export const checkoutUrl = gateway + "/Cashier/AioCheckOut/V5";
export const orderPattern = /^SE[A-F0-9]{18}$/;

export const packages = [
  { points: 30, priceCny: 10, chargeTwd: 45 },
  { points: 240, priceCny: 50, chargeTwd: 225 },
  { points: 500, priceCny: 100, chargeTwd: 450 }
];

export function checkMac(fields) {
  const keys = Object.keys(fields).filter((key) => key !== "CheckMacValue");
  keys.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
  const data = keys.map((key) => key + "=" + fields[key]).join("&");
  const value = encodeURIComponent("HashKey=" + hashKey + "&" + data + "&HashIV=" + hashIv)
    .replace(/%20/g, "+").replace(/'/g, "%27").replace(/~/g, "%7e").toLowerCase();
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

export function signedFields(fields) {
  const payload = { ...fields, MerchantID: merchantId };
  return { ...payload, CheckMacValue: checkMac(payload) };
}

export function validMac(fields) {
  const mac = fields.CheckMacValue;
  return fields.MerchantID === merchantId && typeof mac === "string" && /^[A-F0-9]{64}$/.test(mac) &&
    timingSafeEqual(Buffer.from(mac), Buffer.from(checkMac(fields)));
}

export function taipeiTime(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(date).replaceAll("-", "/");
}

export async function queryTrade(orderNo) {
  const response = await fetch(gateway + "/Cashier/QueryTradeInfo/V5", {
    method: "POST",
    body: new URLSearchParams(signedFields({ MerchantTradeNo: orderNo, TimeStamp: String(Math.floor(Date.now() / 1000)) })),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("ECPay sandbox query failed (" + response.status + ")");
  const result = Object.fromEntries(new URLSearchParams(await response.text()));
  if (!validMac(result) || result.MerchantTradeNo !== orderNo) throw new Error("Invalid ECPay sandbox query response");
  return result;
}
