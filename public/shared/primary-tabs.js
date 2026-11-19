// 底部主导航（2026-11-19 重整）：按使用者要做的事分 5 个 Tab，只在这 5 个一级页面显示。
//   首页：今日短线情绪、我的关注摘要、每日看点
//   题材：当日题材异动、涨停情绪
//   资金：资金流向、宽基ETF、QDII 温度计、全球联动
//   个股：个股分析输入框 + 关注股票池（/watchlist）
//   我的：个人中心
export const PRIMARY_TABS = [
  ["/home", "首页", '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'],
  ["/themes", "题材", '<path d="M12 3.5c.6 3.2 4.8 5.2 4.8 9.7a4.8 4.8 0 0 1-9.6 0c0-2.3 1.2-3.8 2.4-4.8.2 1.7 1 2.7 2.2 3.2.2-2.9-.8-5.4.2-8.1z"/>'],
  ["/funds", "资金", '<circle cx="12" cy="12" r="8.5"/><path d="m9 7.5 3 4 3-4M9 12h6M9 15h6M12 11.5V17"/>'],
  ["/watchlist", "个股", '<path d="M7.5 4v16M16.5 4v16"/><rect x="5.5" y="8" width="4" height="7" rx="1"/><rect x="14.5" y="6.5" width="4" height="8" rx="1"/>'],
  ["/account", "我的", '<circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/>']
];
const current = location.pathname.replace(/\/$/, "");
if (["exp.lfjmwl.com", "localhost", "127.0.0.1"].includes(location.hostname) && PRIMARY_TABS.some(([href]) => href === current)) {
  const nav = document.createElement("nav");
  nav.className = "se-primary-tabs";
  nav.setAttribute("aria-label", "主导航");
  nav.innerHTML = '<div>' + PRIMARY_TABS.map(([href, label, icon]) =>
    `<a href="${href}"${href === current ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></a>`
  ).join("") + '</div>';
  document.body.classList.add("has-se-primary-tabs");
  document.body.append(nav);
}
