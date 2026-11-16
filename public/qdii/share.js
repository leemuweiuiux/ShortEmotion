// /qdiitrend 导出：小卡（当前温度 + 所选信号统计表）与长图（再加历次触发、最新公告与口径）。
// 做法同宽基 ETF：克隆进屏幕外 600px 容器，用 html-to-image 截成 PNG（/shared/export-image.js）。
import { loadImageExporter } from "/shared/export-loader.js?v=1";
import { exportHeader, exportFooter, renderImage, prepareExportAssets, showGallery, withTimeout, esc } from "/shared/export-image.js?v=2";
import { chartMarkup, eventsMarkup, latestCards, noticesMarkup, percent, scaleMarkup, signalNote, signalOf, tableMarkup, trendClass } from "/qdii/board.js?v=12";

export function datesLine(snapshot) {
  const pending = snapshot.families.reduce((sum, family) => sum + family.review.length, 0);
  const closes = snapshot.indices.map((index) => `${index.short}收盘 ${index.indexThrough}`);
  return [`限额核实 ${snapshot.verifiedOn}`, ...closes, ...(pending ? [`${pending} 则公告待核对`] : [])].join(" · ");
}

const section = (title, html) => {
  const node = document.createElement("section");
  node.className = "card qdii-export-card";
  node.innerHTML = `${title ? `<h2 class="card-title">${esc(title)}</h2>` : ""}<div class="qdii-board">${html}</div>`;
  return node;
};

// 小卡：当前温度（大字等级 + 今天 T+N + 本次至今涨跌）+ 历史上该级之后的涨跌 + 近两年走势
function heroMarkup(snapshot) {
  const signal = signalOf(snapshot, snapshot.now.state);
  const event = signal.events[0];
  const since = event ? snapshot.indices.map((index) => {
    const change = event.sinceEntry?.[index.id];
    return change === null || change === undefined ? "" : `<span>${esc(index.short)} <b class="${trendClass(change)}">${percent(change, true)}</b></span>`;
  }).join("") : "";
  return `<div class="qdii-hero" data-level="${esc(signal.id)}">
    <div class="qdii-hero-main"><small>当前温度</small><b>${esc(signal.label)}</b><span>${esc(signal.line)}</span></div>
    ${event ? `<div class="qdii-hero-age"><small>${esc(event.date)} 进入</small><b>T+${event.age}</b><span>美股交易日</span></div>` : ""}
  </div>
  ${scaleMarkup(snapshot)}
  ${since ? `<p class="qdii-hero-since"><small>进入以来</small>${since}</p>` : ""}`;
}

export function buildQdiiExport(snapshot, { signal, index, horizon }, { kind = "card" } = {}) {
  const parts = [exportHeader("美股 QDII 温度计", `指数收盘 ${snapshot.indexThrough} · 限额核实 ${snapshot.verifiedOn}`)];
  parts.push(section("", heroMarkup(snapshot)));
  parts.push(section(`历史上${signal.label}后${index.short}怎么走 · ${signal.events.length} 次`, `${tableMarkup(snapshot, signal, index.id)}<p class="qdii-time">${esc(signalNote(signal))}</p>`));
  parts.push(section(kind === "long" ? "温度走势" : "近两年温度与纳指", chartMarkup(snapshot, { from: kind === "long" ? null : `${Number(snapshot.indexThrough.slice(0, 4)) - 2}${snapshot.indexThrough.slice(4)}`, height: kind === "long" ? 200 : 150, inline: true })));
  if (kind === "long") {
    parts.push(section(`历次${signal.label} · ${index.short} T+${horizon}`, eventsMarkup(signal, index.id, horizon) || '<p class="qdii-time">尚未出现过。</p>'));
    parts.push(section("最新公告", `${latestCards(snapshot, 3)}${noticesMarkup(snapshot.notices.slice(3, 10), false)}`));
    parts.push(section("口径", '<p class="qdii-time">追踪场外纳指100 / 标普500 QDII 全部基金，依暂停申购、收紧与放宽限额的集中程度分为过热、偏热、正常、布局、进场五级；进入某一级的那天算一次。T+N 为美股交易日，起点是进入前最后一个指数收盘；「平时」为 2018 年起任意时点同期限的同一指数。</p>'));
  }
  parts.push(exportFooter({ title: "Market Emotion · 美股 QDII 温度计", line: "QDII 限额拥挤还是宽松？看美股之后怎么走", note: "仅供研究，不构成投资建议。" }));
  return parts;
}

// button：导出按钮；state()：当前所选 { signal, index, horizon }；toast(message, error)
export function setupQdiiShare(button, { snapshot, state, toast }) {
  let busy = false;
  let menu = null;
  const close = () => { menu?.remove(); menu = null; button.setAttribute("aria-expanded", "false"); };
  async function run(kind) {
    close();
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      toast(kind === "long" ? "正在生成长图…" : "正在生成小卡…");
      await loadImageExporter();
      await withTimeout(prepareExportAssets(), 8000).catch(() => {});
      const current = state();
      const blob = await renderImage(buildQdiiExport(snapshot(), current, { kind }), { extraClass: "qdii-export" });
      const title = `美股QDII温度计-${current.signal.label}-${kind === "long" ? "长图" : "小卡"}`;
      showGallery([{ blob, name: `${title}-${snapshot().indexThrough}.png`, title }], { heading: kind === "long" ? "长图" : "分享小卡", shareTitle: title, onError: (error) => toast(`保存失败：${error.message}`, true) });
      toast(kind === "long" ? "长图已生成" : "小卡已生成");
    } catch (error) {
      toast(`导出失败：${error.message || String(error)}`, true);
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu) return close();
    menu = document.createElement("div");
    menu.className = "export-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = '<button type="button" role="menuitem" data-kind="card"><b>导出小卡</b><small>当前温度、所选等级的历史涨跌与近两年走势</small></button><button type="button" role="menuitem" data-kind="long"><b>导出长图</b><small>再加完整走势、历次触发、最新公告与口径</small></button>';
    menu.addEventListener("click", (e) => { const item = e.target.closest("[data-kind]"); if (item) run(item.dataset.kind); });
    button.parentElement.append(menu);
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".qdii-share-wrap")) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
}
