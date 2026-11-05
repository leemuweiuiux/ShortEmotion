// 兑换码共用工具（领取页 /redeem 与管理后台共用）：格式化、从整段文字里找出兑换码、领取链接、分享文案。
// 兑换码三种格式：旧码 20 位十六进制（XXXX-XXXX-XXXX-XXXX-XXXX）、8 位短码（XXXX-XXXX）、自定义口令（6–16 位，原样显示）。

export const SITE = "https://www.lfjmwl.com"; // 分享一律用正式网址（直达、不跳转），在预设网址上生成也不会把预设网址分享出去
export const CODE_PATTERN = /^[A-Z0-9]{6,20}$/;
export const INVITE_PATTERN = /^SE[A-HJKMNP-Z2-9]{6}$/;
const SHORT_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const HEX_PATTERN = /^[A-F0-9]{20}$/;
// 文字里常见、但一定不是兑换码的词
const NOT_CODES = new Set(["SHORTEMOTION", "LFJMWL", "HTTPS", "HTTP", "WWW", "COM", "REDEEM", "CODE"]);

export const normalizeCode = (value) => String(value || "").replace(/[\s-]/g, "").toUpperCase();

/** 显示用：长码每 4 位一组，8 位短码分两组，自定义口令原样。 */
export function displayCode(code) {
  const value = normalizeCode(code);
  if (INVITE_PATTERN.test(value)) return value; // 邀请码照原样，方便用户认出来
  if (HEX_PATTERN.test(value) || SHORT_PATTERN.test(value)) return value.match(/.{1,4}/g).join("-");
  return value;
}

/**
 * 从用户粘贴的内容里找出兑换码：整段就是码 → 链接里的 code= → 分组写法（XXXX-XXXX）→ 同时有字母和数字的词。
 * 找不到返回 ""。
 */
export function extractCode(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const whole = normalizeCode(raw);
  if (CODE_PATTERN.test(whole)) return whole;
  const fromLink = raw.match(/[?&]code=([A-Za-z0-9-]{6,40})/);
  if (fromLink && CODE_PATTERN.test(normalizeCode(fromLink[1]))) return normalizeCode(fromLink[1]);
  const grouped = raw.match(/(?<![A-Za-z0-9])[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){1,4}(?![A-Za-z0-9])/);
  if (grouped) return normalizeCode(grouped[0]);
  const words = raw.match(/[A-Za-z0-9]{6,20}/g) || [];
  const candidate = words.map((word) => word.toUpperCase()).find((word) => !NOT_CODES.has(word) && /[A-Z]/.test(word) && /[0-9]/.test(word));
  return candidate || "";
}

export const redeemLink = (code) => `${SITE}/redeem?code=${encodeURIComponent(normalizeCode(code))}`;

/** 北京时间「11月30日 23:59」；不是今年时带上年份。空值返回 ""。 */
export function dateText(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  const thisYear = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric" }).format(new Date()).replace(/\D/g, "");
  return `${parts.year === thisYear ? "" : `${parts.year}年`}${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
}

export const AUDIENCE = { all: "", new: "仅限新用户（注册 7 天内）", old: "仅限注册满 7 天的用户" };

/** 领取条件的短标签（卡片、落地页用）。code 为数据库返回的兑换码对象（mode、max_claims / maxClaims、expires_at / expiresAt、audience）。 */
export function ruleChips(code) {
  const chips = [];
  const max = code.max_claims ?? code.maxClaims;
  const expires = code.expires_at ?? code.expiresAt;
  if (code.mode === "limited" && max != null) chips.push(`限前 ${max} 名`);
  if (code.mode === "targeted") chips.push("仅限受邀账号");
  if (code.audience === "new") chips.push("新用户专享");
  if (code.audience === "old") chips.push("老用户专享");
  chips.push(expires ? `${dateText(expires)} 截止` : "长期有效");
  chips.push("每人限领一次");
  return chips;
}

/** 分享文案：链接单独一行（微信里才点得到），再附手动输入的方式。 */
export function shareText(code) {
  const rules = ruleChips(code).join(" · ");
  return [
    `【ShortEmotion】送你 ${code.amount} 积分 · ${code.name}`,
    `点击领取：${redeemLink(code.code)}`,
    `或在「个人中心 › 积分兑换」输入 ${displayCode(code.code)}`,
    rules
  ].join("\n");
}

/** 复制到剪贴板；浏览器不允许时退回到选取文字复制。 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    area.remove();
    return ok;
  }
}

/** 二维码 SVG（黑白、留白 2 格），用 qrcode-generator（页面需载入 /short-emotion/vendor/qrcode-generator.js）。 */
export function qrSvg(text) {
  if (!window.qrcode) return "";
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) if (qr.isDark(row, col)) path += `M${col},${row}h1v1h-1z`;
  }
  const full = size + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="领取链接二维码"><rect x="-2" y="-2" width="${full}" height="${full}" fill="#ffffff"/><path fill="#121417" d="${path}"/></svg>`;
}
