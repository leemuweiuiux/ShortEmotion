// 介绍页 /about：简繁切换、主视觉轮换标题、今日情绪（公开摘要接口，不调用 Wind）、个股分析入口、邀请横幅、底部登录按钮。
import { initLanguage, setText, setAttributeText } from "/shared/lang.js?v=17";

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

// ── 今日情绪：A股最新分数（公开摘要），与看板「A股短线情绪」卡同款 ──
function quoteLabel(payload) {
  const match = String(payload.quoteTime || "").match(/^\d{4}(\d{2})(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return "盘中数据";
  const [, month, day, hour, minute] = match;
  return `行情时间 ${month}-${day} ${hour}:${minute}`;
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
    setText($(".live-phase", tile), payload.regime?.phase || "—");
    setText($(".live-posture", tile), payload.regime?.posture ? `当前姿态 · ${payload.regime.posture}` : "—");
    setText($(".live-summary", tile), payload.regime?.summary || "");
    const dimensions = payload.dimensions || {};
    $$(".live-dim", tile).forEach((item) => {
      const value = Number(dimensions[item.dataset.key]);
      if (!Number.isFinite(value)) return;
      $("em", item).style.width = `${Math.max(2, Math.min(100, value))}%`;
      $("b", item).textContent = String(Math.round(value));
    });
    setText($(".live-time", tile), quoteLabel(payload));
    setAttributeText(tile, "aria-label", `A股情绪分 ${score}，${payload.regime?.phase || ""}`);
  } catch {
    setText($(".live-phase", tile), "登录后查看");
  }
}
$$(".live-tile").forEach(loadLive);

// ── 邀请链接 /about?invite=SE…：记下邀请码（7 天，登录页自动填好），显示谁邀请你 ──
const INVITE_PATTERN = /^SE[A-HJKMNP-Z2-9]{6}$/;
const inviteCode = String(new URLSearchParams(location.search).get("invite") || "").replace(/\s+/g, "").toUpperCase();
const accountReady = loadAccount();
if (INVITE_PATTERN.test(inviteCode)) {
  try { localStorage.setItem("se_invite", JSON.stringify({ code: inviteCode, at: Date.now() })); } catch {}
  showInvite(inviteCode);
}

async function showInvite(code) {
  try {
    const response = await fetch(`/api/auth?action=invite-check&code=${encodeURIComponent(code)}`, { headers: { Accept: "application/json" } });
    const result = response.ok ? await response.json() : null;
    if (!result?.valid || (await accountReady)) return; // 邀请码不能用，或已经登录：不显示
    const banner = $(".invite-banner");
    if (result.name) $(".invite-banner-name", banner).textContent = result.name; // 姓名原样显示
    banner.hidden = false;
    setText($(".drawer-copy"), "接受邀请，免费注册");
  } catch {}
}

// ── 底部按钮：未登录「登录」，已登录直接「进入首页」；返回是否已登录 ──
async function loadAccount() {
  try {
    const response = await fetch("/api/auth?action=me", { headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.enabled === false) {
      setText($(".drawer-copy"), "免费使用，打开网页就能看");
    } else if (payload.user) {
      setText($(".drawer-copy"), `已登录 ${payload.user.email || ""}`.trim());
    } else return false;
    const cta = $(".drawer-cta");
    cta.href = "/home";
    setText(cta, "进入首页");
    return true;
  } catch {
    return false;
  }
}
