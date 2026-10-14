// 首页：简繁切换、主视觉轮换词、今日情绪实时读数（读看板同一个接口，不调用 Wind）。
import { HANT, HANT_FIXES } from "/short-emotion/hant-map.js?v=4";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const root = document.documentElement;

// ── 简繁转换：页面原文是简体；台股数据本身是繁体，简体模式下用反向字表转回 ──
const HANS = Object.fromEntries(Object.entries(HANT).map(([hans, hant]) => [hant, hans]));
function toHant(text) {
  let output = String(text).replace(/[一-鿿]/g, (char) => HANT[char] || char);
  for (const [pattern, replacement] of HANT_FIXES) output = output.replace(pattern, replacement);
  return output;
}
const toHans = (text) => String(text).replace(/[一-鿿]/g, (char) => HANS[char] || char);
const convert = (text) => (root.dataset.lang === "hant" ? toHant(text) : toHans(text));

// 记下每段文字与属性的原文，切换语言时从原文重新转换。
const originals = new Map();
const ATTRIBUTES = ["alt", "aria-label", "title"];
function remember(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (/[一-鿿]/.test(node.nodeValue)) originals.set(node, node.nodeValue);
    return;
  }
  for (const attribute of ATTRIBUTES) {
    const value = node.getAttribute?.(attribute);
    if (value && /[一-鿿]/.test(value)) setAttributeText(node, attribute, value, false);
  }
}
function collect(scope) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  remember(scope);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) remember(node);
}
function applyLanguage() {
  for (const [node, value] of originals) {
    if (node.nodeType === Node.TEXT_NODE) node.nodeValue = convert(value);
    else for (const [attribute, text] of Object.entries(value)) node.setAttribute(attribute, convert(text));
  }
  document.title = convert(pageTitle);
  root.lang = root.dataset.lang === "hant" ? "zh-Hant-TW" : "zh-CN";
  $$(".lang-btn").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.lang === root.dataset.lang)));
}
/** 记录属性原文；apply=true 时立即按当前语言写入。 */
function setAttributeText(element, attribute, text, apply = true) {
  originals.set(element, { ...(originals.get(element) || {}), [attribute]: text });
  if (apply) element.setAttribute(attribute, convert(text));
}
/** 写入动态文字：记录原文并按当前语言显示。 */
function setText(element, text) {
  element.textContent = text;
  originals.set(element.firstChild, text);
  element.firstChild.nodeValue = convert(text);
}

const pageTitle = document.title;
collect(document.body);
applyLanguage();
$$(".lang-btn").forEach((button) => button.addEventListener("click", () => {
  root.dataset.lang = button.dataset.lang;
  try { localStorage.setItem("shortemotion:lang", button.dataset.lang); } catch {}
  applyLanguage();
}));

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

// ── 今日情绪：读取两个市场的最新快照 ──
function quoteLabel(market, payload) {
  const match = String(payload.quoteTime || "").match(/^\d{4}(\d{2})(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return market === "tw" ? "收盘后更新" : "盘中每 30 分钟更新";
  const [, month, day, hour, minute] = match;
  return market === "tw" || payload.endOfDay ? `${month}-${day} 收盘` : `${month}-${day} ${hour}:${minute} 行情`;
}

async function loadLive(tile) {
  const market = tile.dataset.market;
  try {
    const response = await fetch(`/api/short-emotion?market=${market}&resource=emotion`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    const score = Math.max(0, Math.min(100, Math.round(Number(payload.score))));
    if (!Number.isFinite(score)) throw new Error("no score");
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
    setText($(".live-phase", tile), "进入看板查看");
  }
}
$$(".live-tile").forEach(loadLive);
