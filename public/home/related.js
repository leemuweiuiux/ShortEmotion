// 首页「你关注的」（原「与你相关」）（2026-11-27）：你关注的股票今天有没有涨跌停、在不在异动题材、所属题材有没有二波，以及大涨大跌、放量。
// 后端用站内已有快照做规则对照（/api/auth?action=watchlist&view=related），不调用大模型。
const body = document.getElementById("home-related-body");
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const SHOWN = 5;

function guide(text, href, label) {
  body.innerHTML = `<p class="home-related-summary">${esc(text)}</p><a class="home-related-action" href="${href}">${esc(label)}</a>`;
}

function render(data) {
  if (!data.total) return guide("添加你关注的股票，Market Emotion 帮你看出今天该先盯哪一只。", "/watchlist?manage=1", "添加关注股票");
  const flagged = (data.items || []).filter((item) => item.tags?.length).slice(0, SHOWN);
  const list = flagged.map((item) => `<li><a href="/technicalanalysis?q=${encodeURIComponent(item.code)}">
      <b>${esc(item.name)}</b><small>${esc(item.code)}</small>
      <span class="home-related-tags">${item.tags.map((tag) => `<i class="home-related-tag is-${esc(tag.kind)}">${esc(tag.text)}</i>`).join("")}</span>
    </a></li>`).join("");
  const more = data.flagged > SHOWN ? `<p class="home-related-quiet">另有 ${data.flagged - SHOWN} 只有异动，到「我的关注」查看。</p>` : "";
  body.innerHTML = `<p class="home-related-summary">${esc(data.summary)}</p>${list ? `<ul class="home-related-list">${list}</ul>` : ""}${more}`;
}

async function load() {
  try {
    const response = await fetch("/api/auth?action=watchlist&view=related", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (response.status === 401) return guide("登录后，这里会对照你关注的股票。", "/login?next=%2Fhome", "登录");
    if (response.status === 404) return void (body.closest("section").hidden = true); // 关注功能未开放的站点
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error);
    render(data);
  } catch {
    body.innerHTML = '<p class="home-related-quiet">暂时无法读取你的关注，稍后再试。</p>';
  }
}

if (body) load();
