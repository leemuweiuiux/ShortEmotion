// 个股分析输入卡（2026-11-19 从首页移到「个股」Tab /watchlist 顶部）：
// 输入股票按「开始分析」→ 跳到 /technicalanalysis 并由那边发起分析（扣 10 积分）。
import { readPoints } from "/shared/request.js?v=1";
import { startAnalysisRefresh } from "/home/analysis-refresh.js?v=1";
import { $, toast, readAnalysisConfig, setPendingAnalysis, validQuery, renderLatest } from "/shared/nav-account.js?v=4";
import { showPointsShortage } from "/shared/points-shortage.js?v=1";

const form = $("#ta-form");
if (form) {
  const input = $("#ta-input");
  const runButton = $("#ta-run");
  const hint = $("#ta-hint");
  let analysis = { configured: true, cost: 10 };
  let balance = null;
  let unlimited = false;

  const renderHint = () => {
    runButton.disabled = !analysis.configured;
    hint.textContent = !analysis.configured ? "*个股分析暂未开通。" : unlimited ? "*不限额账号，分析不扣积分。" : `*首次查询或更新需要 ${analysis.cost} 积分`;
  };

  const loadPoints = async () => {
    try {
      const { response, payload } = await readPoints();
      if (!response.ok) return;
      balance = payload.balance ?? null;
      unlimited = Boolean(payload.unlimited);
      renderHint();
    } catch {}
  };

  startAnalysisRefresh(() => readAnalysisConfig({ includeLatest: true }).then((config) => {
    analysis = config;
    renderLatest($("#ta-latest"), config.latest, (row) => {
      if (row.canView) {
        location.href = `/technicalanalysis?view=${encodeURIComponent(row.code)}`;
        return;
      }
      input.value = String(row.code || "");
      form.requestSubmit(); // 共用余额校验、一次性跳转和分析流程。
    });
    if (config.unlimited) unlimited = true;
    renderHint();
  }).catch(() => {
    if (!$("#ta-latest").querySelector(".ta-stock-pill")) $("#ta-latest").textContent = "大家都在看：暂时无法读取";
  }));
  renderHint();
  loadPoints();
  window.addEventListener("se:points-updated", loadPoints);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = input.value.trim();
    if (!validQuery(q)) {
      toast("请输入六位代码或准确简称", true);
      input.focus();
      return;
    }
    if (!unlimited && balance != null && Number.isFinite(Number(balance)) && balance < analysis.cost) {
      showPointsShortage({ cost: analysis.cost, balance });
      return;
    }
    setPendingAnalysis(q);
    location.href = `/technicalanalysis?q=${encodeURIComponent(q)}`;
  });
}
