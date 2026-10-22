import { readViews, cardHtml } from "./data.js";
const list = document.querySelector("#latest-kandian-list");
if (list) list.innerHTML = readViews().slice(0, 3).map((view) => cardHtml(view, true)).join("");
