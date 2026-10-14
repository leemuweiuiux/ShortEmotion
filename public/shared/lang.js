// 介绍页、登录页共用：简体 / 繁体切换（页面原文是简体）。
// 语言记在 localStorage「shortemotion:lang」；首次访问按浏览器语言（zh-TW / zh-HK 用繁体）。
// 用法：initLanguage() 收集页面文字；动态文字用 setText / setAttributeText 写入，切换语言时会一起转换。
import { HANT, HANT_FIXES } from "/short-emotion/hant-map.js?v=5";

const root = document.documentElement;
const HANS = Object.fromEntries(Object.entries(HANT).map(([hans, hant]) => [hant, hans]));

export function toHant(text) {
  let output = String(text).replace(/[一-鿿]/g, (char) => HANT[char] || char);
  for (const [pattern, replacement] of HANT_FIXES) output = output.replace(pattern, replacement);
  return output;
}
const toHans = (text) => String(text).replace(/[一-鿿]/g, (char) => HANS[char] || char);
export const convert = (text) => (root.dataset.lang === "hant" ? toHant(text) : toHans(text));

// 记下每段文字与属性的原文，切换语言时从原文重新转换。
const originals = new Map();
const ATTRIBUTES = ["alt", "aria-label", "title", "placeholder"];
const HAN = /[一-鿿]/;
let pageTitle = "";

function remember(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (HAN.test(node.nodeValue)) originals.set(node, node.nodeValue);
    return;
  }
  for (const attribute of ATTRIBUTES) {
    const value = node.getAttribute?.(attribute);
    if (value && HAN.test(value)) setAttributeText(node, attribute, value, false);
  }
}

function collect(scope) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  remember(scope);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) remember(node);
}

export function applyLanguage() {
  for (const [node, value] of originals) {
    if (node.nodeType === Node.TEXT_NODE) node.nodeValue = convert(value);
    else for (const [attribute, text] of Object.entries(value)) node.setAttribute(attribute, convert(text));
  }
  document.title = convert(pageTitle);
  root.lang = root.dataset.lang === "hant" ? "zh-Hant-TW" : "zh-CN";
  document.querySelectorAll(".lang-btn").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.lang === root.dataset.lang)));
}

/** 记录属性原文；apply=true 时立即按当前语言写入。 */
export function setAttributeText(element, attribute, text, apply = true) {
  originals.set(element, { ...(originals.get(element) || {}), [attribute]: text });
  if (apply) element.setAttribute(attribute, convert(text));
}

/** 写入动态文字：记录原文并按当前语言显示。 */
export function setText(element, text) {
  element.textContent = text;
  if (!element.firstChild) return;
  originals.set(element.firstChild, text);
  element.firstChild.nodeValue = convert(text);
}

export function initLanguage() {
  pageTitle = document.title;
  collect(document.body);
  applyLanguage();
  document.querySelectorAll(".lang-btn").forEach((button) => button.addEventListener("click", () => {
    root.dataset.lang = button.dataset.lang;
    try { localStorage.setItem("shortemotion:lang", button.dataset.lang); } catch {}
    applyLanguage();
  }));
}
