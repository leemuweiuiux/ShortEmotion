// /qdiitrend 导出：小卡（当前温度、历史涨跌、近两年走势、最新公告各一张）与长图（全部拼成一张，含历次触发与口径）。
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

const footer = () => exportFooter({ title: "Market Emotion · 美股 QDII 温度计", line: "QDII 限额拥挤还是宽松？看美股之后怎么走", note: "仅供研究，不构成投资建议。" });
const stamp = (snapshot) => `指数收盘 ${snapshot.indexThrough} · 限额核实 ${snapshot.verifiedOn}`;
const twoYears = (snapshot) => `${Number(snapshot.indexThrough.slice(0, 4)) - 2}${snapshot.indexThrough.slice(4)}`;

// 各区块（小卡每块一张，长图依次拼接）
function blocks(snapshot, { signal, index, horizon }, kind) {
  const list = [
    { title: "当前温度", html: heroMarkup(snapshot) },
    { title: `历史上${signal.label}后${index.short}怎么走`, html: `${tableMarkup(snapshot, signal, index.id)}<p class="qdii-time">${esc(signalNote(signal))} · 共 ${signal.events.length} 次</p>` },
    { title: kind === "long" ? "温度走势" : "近两年温度与纳指", html: chartMarkup(snapshot, { from: kind === "long" ? null : twoYears(snapshot), height: kind === "long" ? 200 : 170, inline: true }) },
    kind === "long" ? { title: `历次${signal.label} · ${index.short} T+${horizon}`, html: eventsMarkup(signal, index.id, horizon) || '<p class="qdii-time">尚未出现过。</p>' } : null,
    { title: "最新公告", html: `${latestCards(snapshot, 3)}${noticesMarkup(snapshot.notices.slice(3, kind === "long" ? 10 : 7), false)}` },
    kind === "long" ? { title: "口径", html: '<p class="qdii-time">追踪场外纳指100 / 标普500 QDII 全部基金，依暂停申购、收紧与放宽限额的集中程度分为过热、偏热、正常、布局、进场五级；进入某一级的那天算一次。T+N 为美股交易日，起点是进入前最后一个指数收盘；「平时」为 2018 年起任意时点同期限的同一指数。</p>' } : null
  ];
  return list.filter(Boolean);
}

// 长图：一张图拼接全部区块
export function buildQdiiExport(snapshot, state) {
  return [exportHeader("美股 QDII 温度计", stamp(snapshot)), ...blocks(snapshot, state, "long").map((block) => section(block.title, block.html)), footer()];
}

// 小卡：每个区块一张（当前温度、历史涨跌、近两年走势、最新公告）
export function buildQdiiCards(snapshot, state) {
  return blocks(snapshot, state, "card").map((block) => ({
    title: block.title,
    parts: [exportHeader(`美股 QDII 温度计 · ${block.title}`, stamp(snapshot)), section("", block.html), footer()]
  }));
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
      if (kind === "long") toast("正在生成长图…");
      await loadImageExporter();
      await withTimeout(prepareExportAssets(), 8000).catch(() => {});
      const current = state();
      if (kind === "long") {
        const blob = await renderImage(buildQdiiExport(snapshot(), current), { extraClass: "qdii-export" });
        const title = `美股QDII温度计-${current.signal.label}-长图`;
        showGallery([{ blob, name: `${title}-${snapshot().indexThrough}.png`, title }], { heading: "长图", shareTitle: title, onError: (error) => toast(`保存失败：${error.message}`, true) });
        toast("长图已生成");
      } else {
        const cards = buildQdiiCards(snapshot(), current);
        const files = [];
        for (const [i, card] of cards.entries()) {
          toast(`正在生成小卡 ${i + 1}/${cards.length}…`);
          const blob = await renderImage(card.parts, { extraClass: "qdii-export export-card" });
          files.push({ blob, name: `美股QDII温度计-${i + 1}-${card.title}-${snapshot().indexThrough}.png`, title: card.title });
        }
        showGallery(files, { heading: "分享小卡", shareTitle: "美股 QDII 温度计", onError: (error) => toast(`保存失败：${error.message}`, true) });
        toast(`已生成 ${files.length} 张小卡`);
      }
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
    menu.innerHTML = '<button type="button" role="menuitem" data-kind="card"><b>导出小卡</b><small>当前温度、历史涨跌、近两年走势、最新公告，各一张</small></button><button type="button" role="menuitem" data-kind="long"><b>导出长图</b><small>全部内容拼成一张，含历次触发与口径</small></button>';
    menu.addEventListener("click", (e) => { const item = e.target.closest("[data-kind]"); if (item) run(item.dataset.kind); });
    button.parentElement.append(menu);
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".qdii-share-wrap")) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
}
