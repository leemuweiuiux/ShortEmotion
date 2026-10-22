// 起讫日期选择（类似旅游 App 的入住 / 离店）：从底部弹出日历，先点开始、再点结束。
// 规则（2026-10-22 与产品确认）：
//   - 第一次点＝开始，第二次点＝结束，中间整段浅灰；第二次点在开始之前＝改成新的开始；同一天点两次＝只看那一天
//   - 快捷：今天、近 7 天、近 30 天、本月、上月，点了直接套用
//   - 今天之后不能选，最早到 min；一周从周一开始；日期按北京时间
//   - 打开时停在结束日期（没选就是本月）所在的月份，往上滑看更早的月份；「清除」＝回到全部日期
// 样式：/shared/date-range.css。日期一律用「YYYY-MM-DD」字符串，避免时区换算。
const TZ = "Asia/Shanghai";
const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const pad = (value) => String(value).padStart(2, "0");
const parse = (text) => {
  const [y, m, d] = String(text).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const format = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (text, days) => { const date = parse(text); date.setUTCDate(date.getUTCDate() + days); return format(date); };
const clamp = (text, min, max) => (min && text < min ? min : max && text > max ? max : text);
const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / 86_400_000) + 1;

/** 北京时间的今天（YYYY-MM-DD）。 */
export function todayInShanghai(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 「10月16日」；跨年或不是今年时带年份。 */
export function dayLabel(text, today = todayInShanghai()) {
  const date = parse(text);
  const md = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  return text.slice(0, 4) === today.slice(0, 4) ? md : `${date.getUTCFullYear()}年${md}`;
}

/** 选框上显示的文字：{ text, days }；没选时 null。 */
export function rangeLabel(from, to, today = todayInShanghai()) {
  if (!from || !to) return null;
  return { text: from === to ? dayLabel(from, today) : `${dayLabel(from, today)} – ${dayLabel(to, today)}`, days: daysBetween(from, to) };
}

/** 快捷选项的起讫（已按 min / max 截断）；整段都在可选范围外时返回 null。 */
export function presetRange(name, today, min) {
  const monthStart = `${today.slice(0, 7)}-01`;
  let from;
  let to = today;
  if (name === "today") from = today;
  else if (name === "7d") from = addDays(today, -6);
  else if (name === "30d") from = addDays(today, -29);
  else if (name === "month") from = monthStart;
  else if (name === "lastMonth") {
    to = addDays(monthStart, -1);
    from = `${to.slice(0, 7)}-01`;
  } else return null;
  if (min && to < min) return null;
  return { from: clamp(from, min, today), to };
}

const PRESETS = [["today", "今天"], ["7d", "近 7 天"], ["30d", "近 30 天"], ["month", "本月"], ["lastMonth", "上月"]];

/**
 * 打开日期选择。from / to：目前的起讫（可空）；min：最早可选日（可空）；max：最晚可选日（默认北京时间今天）。
 * 回传 Promise：确定或快捷 → { from, to }；清除 → { from: "", to: "" }；关掉 → null。
 */
export function openDateRange({ from = "", to = "", min = "", max = "", title = "选择日期" } = {}) {
  const today = todayInShanghai();
  const last = max || today;
  let start = from || "";
  let end = to || "";
  let picking = start && !end ? "end" : "start";

  return new Promise((resolve) => {
    const opener = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "dr-backdrop";
    backdrop.innerHTML = `<div class="dr-sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="dr-head"><b>${title}</b><button type="button" class="dr-close" aria-label="关闭">✕</button></div>
      <div class="dr-pick"><div class="dr-side" data-side="start"><small>开始</small><strong></strong><small></small></div><i class="dr-days"></i><div class="dr-side" data-side="end"><small>结束</small><strong></strong><small></small></div></div>
      <div class="dr-presets">${PRESETS.map(([key, label]) => `<button type="button" data-preset="${key}">${label}</button>`).join("")}</div>
      <div class="dr-week" aria-hidden="true">${WEEK.map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="dr-months"></div>
      <div class="dr-foot"><button type="button" class="btn-secondary" data-action="clear">清除</button><button type="button" class="btn-primary" data-action="apply"></button></div>
    </div>`;
    const monthsHost = backdrop.querySelector(".dr-months");
    const applyButton = backdrop.querySelector('[data-action="apply"]');

    // 月份：从 min 所在月（没有 min 时往前 12 个月）到 max 所在月
    const firstMonth = (min || addDays(last, -365)).slice(0, 7);
    const months = [];
    for (let cursor = parse(`${firstMonth}-01`); format(cursor).slice(0, 7) <= last.slice(0, 7); cursor.setUTCMonth(cursor.getUTCMonth() + 1)) months.push(format(cursor).slice(0, 7));
    monthsHost.innerHTML = months.map((month) => {
      const first = parse(`${month}-01`);
      const blanks = (first.getUTCDay() + 6) % 7; // 周一开始
      const cells = Array.from({ length: blanks }, () => '<i aria-hidden="true"></i>');
      for (let day = first; format(day).slice(0, 7) === month; day = parse(addDays(format(day), 1))) {
        const text = format(day);
        const off = text > last || (min && text < min);
        cells.push(`<button type="button" class="dr-day" data-day="${text}"${off ? " disabled" : ""} aria-label="${dayLabel(text, today)} ${WEEKDAY[day.getUTCDay()]}"><span>${day.getUTCDate()}</span><small></small></button>`);
      }
      return `<div class="dr-month" data-month="${month}"><h4>${Number(month.slice(0, 4))}年${Number(month.slice(5))}月</h4><div class="dr-grid">${cells.join("")}</div></div>`;
    }).join("");

    function sideText(side, value) {
      const element = backdrop.querySelector(`[data-side="${side}"]`);
      const [, strong, weekday] = element.children;
      strong.textContent = value ? dayLabel(value, today) : "请选择";
      strong.classList.toggle("empty", !value);
      weekday.textContent = value ? WEEKDAY[parse(value).getUTCDay()] : "";
      element.classList.toggle("on", picking === side);
    }

    function render() {
      sideText("start", start);
      sideText("end", end);
      backdrop.querySelector(".dr-days").textContent = start && end ? `${daysBetween(start, end)} 天` : "—";
      for (const cell of monthsHost.querySelectorAll(".dr-day")) {
        const day = cell.dataset.day;
        const isStart = day === start;
        const isEnd = day === end;
        cell.classList.toggle("start", isStart);
        cell.classList.toggle("end", isEnd);
        cell.classList.toggle("mid", Boolean(start && end && day > start && day < end));
        cell.setAttribute("aria-pressed", String(isStart || isEnd));
        cell.querySelector("small").textContent = isStart && isEnd ? "单日" : isStart ? "开始" : isEnd ? "结束" : day === today ? "今天" : "";
      }
      let matched = false; // 几个快捷截断后可能是同一段（例如刚上线时），只亮第一个
      for (const button of backdrop.querySelectorAll("[data-preset]")) {
        const range = presetRange(button.dataset.preset, today, min);
        const on = Boolean(range && !matched && start === range.from && end === range.to);
        matched ||= on;
        button.disabled = !range;
        button.classList.toggle("on", on);
      }
      applyButton.disabled = !(start && end);
      applyButton.textContent = start && end ? `确定 · ${daysBetween(start, end)} 天` : start ? "请选择结束日期" : "请选择开始日期";
    }

    const close = (value) => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("dr-lock");
      backdrop.remove();
      opener?.focus?.();
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") close(null); };

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest(".dr-close")) return close(null);
      const day = event.target.closest(".dr-day:not(:disabled)")?.dataset.day;
      if (day) {
        if (picking === "start" || !start) { start = day; end = ""; picking = "end"; }
        else if (day < start) start = day; // 点在开始之前：改成新的开始
        else { end = day; picking = "start"; }
        return render();
      }
      const preset = event.target.closest("[data-preset]")?.dataset.preset;
      if (preset) {
        const range = presetRange(preset, today, min);
        if (range) close(range);
        return;
      }
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "clear") close({ from: "", to: "" });
      if (action === "apply" && start && end) close({ from: start, to: end });
    });
    // 点「开始」「结束」可以改选那一端
    backdrop.querySelector(".dr-pick").addEventListener("click", (event) => {
      const side = event.target.closest("[data-side]")?.dataset.side;
      if (!side) return;
      picking = side === "end" && !start ? "start" : side;
      render();
    });

    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("dr-lock");
    document.body.append(backdrop);
    render();
    // 停在结束日期（或今天）所在的月份
    const anchor = (end || start) && monthsHost.querySelector(`[data-month="${(end || start).slice(0, 7)}"]`);
    monthsHost.scrollTop = anchor ? anchor.offsetTop - monthsHost.offsetTop : monthsHost.scrollHeight;
    (monthsHost.querySelector(".dr-day.end, .dr-day.start") || backdrop.querySelector(".dr-close")).focus({ preventScroll: true });
  });
}
