const features = {
  anomalies: '题材异动',
  limitup: '涨停情绪',
  sectorflow: '资金流向',
  etfflow: '宽基ETF'
};

export function showUnlockSuccess(toast, feature, payload) {
  if (!payload?.charged) return;
  const balance = payload.balance;
  if (balance == null || !Number.isFinite(Number(balance))) return;
  toast(`已解锁${features[feature]}，剩余${balance}积分`);
}
