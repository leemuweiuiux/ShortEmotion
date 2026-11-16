import { HANS } from "./hans-map.js?v=1";

const ATTRIBUTES = ["alt", "aria-label", "title", "placeholder"];
export const convert = (text) => String(text).replace(/[一-鿿]/g, (char) => HANS[char] || char);

export function setAttributeText(element, attribute, text) {
  element.setAttribute(attribute, convert(text));
}

export function setText(element, text) {
  element.textContent = convert(text);
}

export function initLanguage() {
  document.documentElement.lang = "zh-CN";
  document.title = convert(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement?.matches("script, style")) node.nodeValue = convert(node.nodeValue);
      continue;
    }
    for (const attribute of ATTRIBUTES) {
      const value = node.getAttribute(attribute);
      if (value) setAttributeText(node, attribute, value);
    }
  }
}
