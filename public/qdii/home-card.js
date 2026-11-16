// 首页「纳指 QDII 限额」模块（在全球联动下方）：只显示三张状态卡，不可交互；点「查看更多」进 /qdiitrend 操作。
// 只在 Exp 站显示（主站 /qdii* 由 middleware 返回 404）。
import { whenNearViewport } from "/shared/viewport-load.js?v=1";
import { loadQdiiSnapshot, staticFundCards } from "/qdii/board.js?v=3";

const block = document.getElementById("qdii-card");
const body = document.getElementById("qdii-home-body");

if (block && ["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(location.hostname)) {
  block.hidden = false;
  whenNearViewport(block, async () => {
    try {
      body.innerHTML = staticFundCards(await loadQdiiSnapshot());
    } catch {
      body.innerHTML = '<div class="empty">暂时无法读取限额快照，请刷新页面重试。</div>';
    }
  });
}
