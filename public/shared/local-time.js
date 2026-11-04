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
