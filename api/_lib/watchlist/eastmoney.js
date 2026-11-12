let queue = Promise.resolve();
let nextRequestAt = 0;
let cooldownUntil = 0;

async function request(url) {
  const pending = queue.then(async () => {
    if (Date.now() < cooldownUntil) throw new Error("EASTMONEY_RATE_LIMIT");
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())));
    nextRequestAt = Date.now() + 1200;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(12000)
    });
    if ([403, 429].includes(response.status)) {
      cooldownUntil = Date.now() + 20 * 60 * 1000;
      throw new Error("EASTMONEY_RATE_LIMIT");
    }
    if (!response.ok) throw new Error("Eastmoney HTTP " + response.status);
    return response.json();
  });
  queue = pending.catch(() => {});
  return pending;
}

export async function fetchDailyBars(code, start, end, adjusted) {
  if (!/^\d{6}\.(SH|SZ|BJ|CSI)$/.test(code)) throw new Error("Invalid ticker");
  const secid = (code.endsWith(".SH") || code.endsWith(".CSI") ? "1." : "0.") + code.slice(0, 6);
  const params = new URLSearchParams({
    secid, fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56",
    klt: "101", fqt: adjusted ? "2" : "0",
    beg: start.replaceAll("-", ""), end: end.replaceAll("-", "")
  });
  let lastError;
  // Overseas runtimes often see the peer drop TLS mid-handshake; retry each host once before failing over.
  for (const host of ["push2his.eastmoney.com", "33.push2his.eastmoney.com", "push2his.eastmoney.com", "33.push2his.eastmoney.com"]) {
    try {
      const payload = await request("https://" + host + "/api/qt/stock/kline/get?" + params);
      const data = payload?.data;
      if (data?.code !== code.slice(0, 6) || !Array.isArray(data.klines)) throw new Error("Unexpected market series");
      const rows = data.klines.map(line => {
        const [day, ...values] = line.split(",");
        const [open, close, high, low, lots] = values.map(Number);
        return { day, open, close, high, low, volume: lots * 100 };
      }).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.day) && row.day >= start && row.day <= end
        && [row.open, row.close, row.high, row.low, row.volume].every(n => Number.isFinite(n) && n > 0)
        && row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close));
      if (!rows.length) throw new Error("No usable market bars for " + code);
      return [...new Map(rows.map(row => [row.day, row])).values()].sort((a, b) => a.day.localeCompare(b.day));
    } catch (error) {
      if (error.message === "EASTMONEY_RATE_LIMIT") throw error;
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}

export async function resolveStock(query) {
  const normalized = query.toUpperCase();
  const input = normalized.replace(/\.(SH|SZ|BJ)$/, "");
  const params = new URLSearchParams({ input, type: "14", count: "20" });
  let payload;
  for (let attempt = 0; ; attempt++) {
    try {
      payload = await request("https://searchapi.eastmoney.com/api/suggest/get?" + params);
      break;
    } catch (error) {
      if (attempt >= 1 || error.message === "EASTMONEY_RATE_LIMIT") {
        throw Object.assign(new Error("股票查询暂时不可用，请稍后重试"), { statusCode: 503 });
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const candidates = (payload?.QuotationCodeTable?.Data || []).filter(row =>
    row.Classify === "AStock" && /^(沪A|深A|京A)$/.test(row.SecurityTypeName));
  const match = candidates.find(row => row.Code === input || row.Name === query);
  if (!match) throw Object.assign(new Error("未找到股票，请输入六位代码或完整名称"), { statusCode: 400 });
  const suffix = { "沪A": "SH", "深A": "SZ", "京A": "BJ" }[match.SecurityTypeName];
  const code = match.Code + "." + suffix;
  if (normalized.includes(".") && normalized !== code) throw Object.assign(new Error("股票代码与交易所不匹配"), { statusCode: 400 });
  return { code, name: match.Name };
}
