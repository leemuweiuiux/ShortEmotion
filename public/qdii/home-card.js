// 首页「纳指 QDII 限额」模块：只在 Exp 站显示（主站 /qdii 由 middleware 返回 404）。
import { whenNearViewport } from "/shared/viewport-load.js?v=1";
import { loadQdiiSnapshot, mountQdiiBoard } from "/qdii/board.js?v=1";

const card = document.getElementById("qdii-card");
const body = document.getElementById("qdii-home-body");

if (card && ["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(location.hostname)) {
  card.hidden = false;
  whenNearViewport(card, async () => {
    try {
      mountQdiiBoard(body, await loadQdiiSnapshot());
    } catch {
      body.innerHTML = '<div class="empty">暂时无法读取限额快照，请刷新页面重试。</div>';
    }
  });
}
