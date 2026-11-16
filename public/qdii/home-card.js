// 首页「美股 QDII 温度计」模块（在全球联动下方）：温度状态 + 最新三则公告（最新在最左），不可交互；点「查看更多」进 /qdiitrend。
// 主站与 Exp 显示（Demo 子网域 /qdii* 由 middleware 返回 404）。
import { whenNearViewport } from "/shared/viewport-load.js?v=1";
import { latestCards, loadQdiiSnapshot, thermoMarkup } from "/qdii/board.js?v=9";

const block = document.getElementById("qdii-card");
const body = document.getElementById("qdii-home-body");

if (block && ["lfjmwl.com", "www.lfjmwl.com", "stockmarketshortemotion.vercel.app", "exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(location.hostname)) {
  block.hidden = false;
  whenNearViewport(block, async () => {
    try {
      const snapshot = await loadQdiiSnapshot();
      body.innerHTML = `${thermoMarkup(snapshot)}<h3 class="qdii-group-title">最新公告</h3>${latestCards(snapshot)}`;
    } catch {
      body.innerHTML = '<div class="empty">暂时无法读取限额快照，请刷新页面重试。</div>';
    }
  });
}
