const links = [
  ["/home", "市场", '<path d="M3 19h18M5 15l5-5 4 3 5-7m-4 0h4v4"/>'],
  ["/watchlist", "关注", '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 9.6l6.2-.9L12 3z"/>'],
  ["/account", "我的", '<circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/>']
];
const current = location.pathname.replace(/\/$/, "");
if (["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(location.hostname) && links.some(([href]) => href === current)) {
  const nav = document.createElement("nav");
  nav.className = "se-primary-tabs";
  nav.setAttribute("aria-label", "主导航");
  const traditional = document.documentElement.dataset.lang === "hant";
  nav.innerHTML = '<div>' + links.map(([href, label, icon], index) =>
    `<a href="${href}"${href === current ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${traditional ? ["市場", "關注", "我的"][index] : label}</span></a>`
  ).join("") + '</div>';
  document.body.classList.add("has-se-primary-tabs");
  document.body.append(nav);
}
