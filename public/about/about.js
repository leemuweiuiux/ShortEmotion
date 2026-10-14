// 介绍页 /about：简繁切换、主视觉轮换词、今日情绪（公开摘要接口，不调用 Wind）、底部登录按钮。
import { initLanguage, setText, setAttributeText } from "/shared/lang.js?v=1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

initLanguage();

// ── 主视觉轮换词 ──
const WORDS = ["量化", "拆解", "追踪"];
const word = $(".hero-word");
if (word && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  let index = 0;
  setInterval(() => {
    index = (index + 1) % WORDS.length;
    word.classList.add("swap");
    setTimeout(() => {
      setText(word, WORDS[index]);
      word.classList.remove("swap");
    }, 280);
  }, 2800);
}

// ── 今日情绪：两个市场的最新分数（公开摘要） ──
function quoteLabel(market, payload) {
  const match = String(payload.quoteTime || "").match(/^\d{4}(\d{2})(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return market === "tw" ? "收盘后更新" : "盘中每 30 分钟更新";
  const [, month, day, hour, minute] = match;
  return market === "tw" || payload.endOfDay ? `${month}-${day} 收盘` : `${month}-${day} ${hour}:${minute} 行情`;
}

async function loadLive(tile) {
  const market = tile.dataset.market;
  try {
    const response = await fetch(`/api/short-emotion?market=${market}&resource=summary`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    const score = Math.max(0, Math.min(100, Math.round(Number(payload.score))));
    if (payload.score == null || !Number.isFinite(score)) throw new Error("no score");
    $(".live-ring", tile).style.setProperty("--score", score);
    setText($(".live-score", tile), String(score));
    const phase = $(".live-phase", tile);
    phase.textContent = "";
    phase.append(document.createTextNode(""));
    setText(phase, payload.regime?.phase || "—");
    if (payload.regime?.posture) {
      const posture = document.createElement("small");
      phase.append(posture);
      setText(posture, payload.regime.posture);
    }
    setText($(".live-time", tile), quoteLabel(market, payload));
    setAttributeText(tile, "aria-label", `${market === "tw" ? "台股" : "A股"}情绪分 ${score}，${payload.regime?.phase || ""}`);
  } catch {
    setText($(".live-phase", tile), "登录后查看");
  }
}
$$(".live-tile").forEach(loadLive);

// ── 底部按钮：未登录「登录」，已登录直接「进入看板」 ──
async function loadAccount() {
  try {
    const response = await fetch("/api/auth?action=me", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.enabled === false) {
      setText($(".drawer-copy"), "免费使用，打开网页就能看");
    } else if (payload.user) {
      setText($(".drawer-copy"), `已登录 ${payload.user.email || ""}`.trim());
    } else return;
    const cta = $(".drawer-cta");
    cta.href = "/shortemotion/cn";
    setText(cta, "进入看板");
  } catch {}
}
loadAccount();
