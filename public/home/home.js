// 首页 /home（登录后打开 / 会到这里）
//   1. 个股技术分析：输入股票按「开始分析」→ 跳到 /technicalanalysis 并由那边发起分析（扣 10 积分）
//   2. 今日短线情绪：分数与阶段（公开摘要接口，不扣分），点卡片进入看板
import { $, toast, initAccountMenu, readAnalysisConfig, setPendingAnalysis, validQuery } from "/shared/nav-account.js?v=1";

initAccountMenu();

const form = $("#ta-form");
const input = $("#ta-input");
const runButton = $("#ta-run");
const hint = $("#ta-hint");

function renderAnalysis(config) {
  runButton.innerHTML = `开始分析${config.unlimited ? "" : `<small>−${config.cost} 积分</small>`}`;
  runButton.disabled = !config.configured;
  if (!config.configured) hint.textContent = "个股分析暂未开通，开通后即可使用。";
  else if (config.unlimited) hint.textContent = "不限额账号，分析不扣积分。";
  else hint.textContent = `每次分析扣 ${config.cost} 积分${Number.isFinite(Number(config.balance)) ? `，当前余额 ${config.balance}` : ""}`;
}

renderAnalysis({ configured: true, cost: 10, balance: null, unlimited: false });
readAnalysisConfig().then(renderAnalysis).catch(() => {});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const q = input.value.trim();
  if (!validQuery(q)) {
    toast("请输入六位代码或准确简称", true);
    input.focus();
    return;
  }
  setPendingAnalysis(q);
  location.href = `/technicalanalysis?q=${encodeURIComponent(q)}`;
});

// 今日短线情绪（与介绍页同一个公开摘要接口）
async function loadEmotion() {
  try {
    const response = await fetch("/api/short-emotion?market=cn&resource=summary", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error();
    const summary = await response.json();
    const score = Number(summary.score);
    $("#emotion-score").textContent = Number.isFinite(score) ? Math.round(score) : "—";
    $("#emotion-ring").style.setProperty("--score", Number.isFinite(score) ? score : 0);
    $("#emotion-phase").textContent = summary.regime?.phase || "—";
    $("#emotion-posture").textContent = summary.regime?.posture ? `当前姿态 · ${summary.regime.posture}` : "—";
  } catch {
    $("#emotion-phase").textContent = "暂时无法读取";
  }
}
loadEmotion();
