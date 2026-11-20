// Wind's zone-less A-share quote times are Beijing time. Storage timestamps
// carry their own offset; display both instants in the viewer's device timezone.
export function parseDataTime(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const quote = text.match(/^(\d{4})-?(\d{2})-?(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  const date = new Date(quote
    ? `${quote[1]}-${quote[2]}-${quote[3]}T${quote[4]}:${quote[5]}:${quote[6] || "00"}+08:00`
    : text);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function localTimeLabel(value, timeZone) {
  const date = parseDataTime(value);
  if (!date) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset"
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}（${parts.timeZoneName.replace("GMT", "UTC")}）`;
}

export function emotionTimeLabel(data) {
  const quote = localTimeLabel(data?.quoteTime);
  const updated = localTimeLabel(data?.storedAt || data?.capturedAt);
  return [quote ? `行情时间 ${quote}` : "未返回行情时间", updated ? `最近更新 ${updated}` : null]
    .filter(Boolean).join(" · ");
}

// ── 统一的数据更新标签：「盘中 · 11-20 14:35」/「已收盘 · 11-20 15:05」（北京时间，跨年才带年份）──
// at：数据生成时间（ISO 或 Wind 无时区时间）；day：没有生成时间时退回交易日（YYYYMMDD / YYYY-MM-DD）。
// closed：明确是否收盘；不传时按生成时间判断（当天交易日 09:15–15:00 内算盘中）。partial：部分数据未更新。
const BEIJING = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const beijingParts = (date) => Object.fromEntries(BEIJING.formatToParts(date).map((part) => [part.type, part.value]));

export function asofInfo({ at, day, closed, partial } = {}) {
  const now = beijingParts(new Date());
  const date = parseDataTime(at);
  let text;
  let live = false;
  if (date) {
    const p = beijingParts(date);
    const minute = Number(p.hour) * 60 + Number(p.minute);
    const today = `${p.year}${p.month}${p.day}` === `${now.year}${now.month}${now.day}`;
    live = closed == null ? today && !/Sat|Sun/.test(p.weekday) && minute >= 9 * 60 + 15 && minute < 15 * 60 : !closed;
    text = `${p.year === now.year ? "" : `${p.year}-`}${p.month}-${p.day} ${p.hour}:${p.minute}`;
  } else {
    const match = String(day || "").match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    if (!match) return null;
    text = `${match[1] === now.year ? "" : `${match[1]}-`}${match[2]}-${match[3]}`;
  }
  return { live, text: `${live ? "盘中" : "已收盘"} · ${text}${partial ? " · 部分未更新" : ""}` };
}

export const asofLabel = (options) => asofInfo(options)?.text || "";

const ASOF_STYLE = ".asof{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-variant-numeric:tabular-nums}"
  + ".asof:not(.asof-plain)::before{content:\"\";flex:none;width:6px;height:6px;border-radius:50%;background:var(--muted,#8a8f98)}"
  + ".asof[data-asof=live]:not(.asof-plain)::before{background:#2fa36b}";

/** 把统一标签写进元素；plain=true 时不画圆点（已有状态点的位置用）。 */
export function renderAsof(element, options, { fallback = "", plain = false } = {}) {
  if (!element) return null;
  if (!document.getElementById("asof-style")) {
    const style = document.createElement("style");
    style.id = "asof-style";
    style.textContent = ASOF_STYLE;
    document.head.append(style);
  }
  const info = asofInfo(options);
  element.textContent = info?.text || fallback;
  element.classList.add("asof");
  element.classList.toggle("asof-plain", plain);
  if (info) element.dataset.asof = info.live ? "live" : "closed";
  else delete element.dataset.asof;
  return info;
}
