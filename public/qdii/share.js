// /qdiitrend 导出：小卡（所选基金申购状态 + 当前统计表）与长图（全部基金状态 + 统计表 + 历次调整 + 口径）。
// 做法同宽基 ETF：克隆进屏幕外 600px 容器，用 html-to-image 截成 PNG（/shared/export-image.js）。
import { loadImageExporter } from "/shared/export-loader.js?v=1";
import { exportHeader, exportFooter, renderImage, prepareExportAssets, showGallery, withTimeout, esc } from "/shared/export-image.js?v=2";
import { NOTE, directionLabel, indexGroups, staticCard, staticFundCards, tableMarkup } from "/qdii/board.js?v=8";

export function datesLine(snapshot) {
  const checked = snapshot.funds.map((fund) => fund.checkedThrough || snapshot.verifiedOn).sort()[0];
  const closes = indexGroups(snapshot).map((group) => `${group.short}收盘 ${group.indexThrough || snapshot.indexThrough}`);
  return [`限额核实 ${checked}`, ...closes].join(" · ");
}

const section = (title, html) => {
  const node = document.createElement("section");
  node.className = "card qdii-export-card";
  node.innerHTML = `${title ? `<h2 class="card-title">${esc(title)}</h2>` : ""}<div class="qdii-board">${html}</div>`;
  return node;
};

export function buildQdiiExport(snapshot, { fund, direction, horizon, index }, { kind = "card", eventsHtml = "" } = {}) {
  const parts = [exportHeader("美股 QDII 限额", datesLine(snapshot))];
  parts.push(kind === "long"
    ? section("申购状态", staticFundCards(snapshot))
    : section(`${index.short} · 申购状态`, `<div class="qdii-funds qdii-export-single">${staticCard(fund, index.indexThrough || snapshot.indexThrough)}</div>`));
  parts.push(section(`${fund.name} · ${directionLabel[direction]}后${index.name}涨跌`, `${tableMarkup(snapshot, fund, direction)}<p class="qdii-time">${esc(NOTE)}</p>`));
  if (kind === "long") {
    parts.push(section(`历次${directionLabel[direction]} · T+${horizon}`, eventsHtml || '<p class="qdii-time">暂无相应的限额变动。</p>'));
    parts.push(section("口径", '<p class="qdii-time">限额取基金公司公告的人民币场外单账户日限额（直销、代销不同时取代销）。T+N 为美股交易日，起点是公告日前最后一个指数收盘；命中率 = 命中次数 ÷ 已到期次数；「平时」为 2020 年起任意时点同期限同一指数的下跌（收紧）或上涨（放宽）比例。各次区间可能重叠，累计数字需结合次数看。</p>'));
  }
  parts.push(exportFooter({ title: "Market Emotion · 美股 QDII 限额", line: "收紧看跌、放宽看涨：限额调整后美股指数怎么走", note: "仅供研究，不构成投资建议。" }));
  return parts;
}

// button：导出按钮；state()：当前所选；events()：长图里的历次调整；toast(message, error)
export function setupQdiiShare(button, { snapshot, state, events, toast }) {
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
      const blob = await renderImage(buildQdiiExport(snapshot(), current, { kind, eventsHtml: events() }), { extraClass: "qdii-export" });
      const title = `美股QDII限额-${current.fund.name}-${kind === "long" ? "长图" : "小卡"}`;
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
    menu.innerHTML = '<button type="button" role="menuitem" data-kind="card"><b>导出小卡</b><small>所选基金状态与当前统计表</small></button><button type="button" role="menuitem" data-kind="long"><b>导出长图</b><small>全部基金状态、统计表、历次调整与口径</small></button>';
    menu.addEventListener("click", (e) => { const item = e.target.closest("[data-kind]"); if (item) run(item.dataset.kind); });
    button.parentElement.append(menu);
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".qdii-share-wrap")) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
}
