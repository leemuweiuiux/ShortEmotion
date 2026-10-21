// 介绍页 /about：简繁切换、主视觉轮换标题、今日情绪（公开摘要接口，不调用 Wind）、个股分析入口、底部登录按钮。
import { initLanguage, setText, setAttributeText } from "/shared/lang.js?v=13";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

initLanguage();

// ── 主视觉轮换标题：动词与对象成对一起换（后段都是 7 个字） ──
const PAIRS = [
  ["量化", "每天的短线情绪"],
  ["追踪", "当日的题材异动"],
  ["拆解", "个股的技术走势"],
  ["测算", "个股的胜率赔率"]
];
const word = $(".hero-word");
const object = $(".hero-object");
if (word && object && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  let index = 0;
  setInterval(() => {
    index = (index + 1) % PAIRS.length;
    word.classList.add("swap");
    object.classList.add("swap");
    setTimeout(() => {
      setText(word, PAIRS[index][0]);
      setText(object, PAIRS[index][1]);
      word.classList.remove("swap");
      object.classList.remove("swap");
    }, 340);
  }, 3200);
}

// ── 个股技术分析入口：去掉多余空白；空白时不提交 ──
const taForm = $(".ta-tile");
taForm?.addEventListener("submit", (event) => {
  const input = taForm.elements.q;
  input.value = input.value.trim();
  if (!input.value) {
    event.preventDefault();
    input.focus();
  }
});

// ── 今日情绪：A股最新分数（公开摘要） ──
function quoteLabel(payload) {
  const match = String(payload.quoteTime || "").match(/^\d{4}(\d{2})(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return "盘中数据";
  const [, month, day, hour, minute] = match;
  return `${month}-${day} ${hour}:${minute}`;
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
    setText($(".live-time", tile), quoteLabel(payload));
    setAttributeText(tile, "aria-label", `A股情绪分 ${score}，${payload.regime?.phase || ""}`);
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
    cta.href = "/home";
    setText(cta, "进入首页");
  } catch {}
}
loadAccount();
