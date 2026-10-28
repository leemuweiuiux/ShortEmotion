// Offline fixtures for local development and tests (WIND_MOCK=1).
// Shapes mirror real Wind MCP results closely enough to exercise the whole engine;
// the numbers are synthetic and must never be shown as market data.

const TZ = "Asia/Shanghai";

function beijingNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { day: `${parts.year}${parts.month}${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function quoteTime() {
  const now = beijingNow();
  return `${now.day} ${now.time}`;
}

function table(columns, rows) {
  return { columns: columns.map((name) => ({ name })), rows };
}

function result(inner) {
  return { content: [{ type: "text", text: JSON.stringify(inner) }] };
}

const LIMIT_UP = [
  ["300024.SZ", "机器人A", "机器人;人形机器人;减速器"],
  ["002527.SZ", "新时达", "机器人;人形机器人;工业母机"],
  ["603728.SH", "鸣志电器", "机器人;人形机器人;丝杠"],
  ["300124.SZ", "汇川样本", "机器人;工业自动化"],
  ["688256.SH", "寒武样本", "AI算力;芯片;数据中心"],
  ["603019.SH", "中科样本", "AI算力;服务器;数据中心"],
  ["300308.SZ", "光模样本", "CPO;光模块;AI算力"],
  ["600598.SH", "北大荒样本", "农业;种业;粮食"]
];

const CONCEPTS = [
  ["8841416.WI", "人形机器人指数", 3.1, 101.8, 98.6],
  ["8841234.WI", "CPO概念指数", 2.4, 87.2, 85.4],
  ["8841102.WI", "AI算力指数", 1.9, 66.1, 64.9],
  ["8841301.WI", "种业指数", 1.6, 41.3, 40.6],
  ["8841555.WI", "商业航天指数", 0.8, 55.2, 54.8]
];

// ── 个股技术分析的离线样本：几只虚构股票 + 指数，按代码生成确定的随机走势（数字是合成的）──
const KLINE_COLUMNS = ["TIME", "OPEN", "MATCH", "HIGH", "LOW", "TURNOVER", "VOLUME", "CHANGEHANDRATE", "AVPRICE"];
const MOCK_STOCKS = [
  { code: "603936.SH", name: "样本电子", base: 18, drift: 0.0006 },
  { code: "300986.SZ", name: "样本新材", base: 11, drift: -0.0002, surge: true }, // 近 3 日连续大涨，会触发事件检索
  { code: "688001.SH", name: "样本科技", base: 42, drift: 0.0003 },
  { code: "600999.SH", name: "样本故障", base: 9, drift: 0, failKline: true }, // 认得出、但取日 K 失败（测试「失败退回积分」）
  { code: "688002.SH", name: "样本新高", base: 5, drift: 0.0012, surge: true } // 一路上涨、近 6 年都在新高（测试「波动推算」）
];
const MOCK_INDEXES = { "000001.SH": 3100, "399001.SZ": 10200, "399006.SZ": 2100, "000688.SH": 950 };

function mockStock(windcode) {
  const text = String(windcode || "").trim().toUpperCase();
  return MOCK_STOCKS.find((item) => item.code === text || item.name === String(windcode || "").trim()) || null;
}

function seeded(seedText) {
  let seed = [...String(seedText)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const ymd = (date) => date.toISOString().slice(0, 10);
const parseDay = (text) => { const value = String(text).replaceAll("-", ""); return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)))); };

/** 日 K：从 2018 年起按代码生成同一条走势，再截取 begin–end（周末跳过）。 */
function mockDaily(windcode, begin, end) {
  const code = String(windcode || "").toUpperCase();
  const stock = MOCK_STOCKS.find((item) => item.code === code);
  const base = stock?.base ?? MOCK_INDEXES[code] ?? 10;
  const drift = stock?.drift ?? 0.0002;
  const vol = stock ? 0.024 : 0.011;
  const random = seeded(code);
  const rows = [];
  let close = base;
  const last = parseDay(end);
  const days = [];
  for (let date = parseDay("20180102"); date <= last; date = new Date(date.getTime() + 86_400_000)) {
    if (![0, 6].includes(date.getUTCDay())) days.push(new Date(date));
  }
  days.forEach((date, index) => {
    const prev = close;
    const surgeDay = stock?.surge && index >= days.length - 3;
    const change = surgeDay ? 0.1 : drift + (random() - 0.5) * 2 * vol;
    close = Math.max(base * 0.3, prev * (1 + change));
    const open = prev * (1 + (random() - 0.5) * vol * 0.6);
    const upper = random();
    const high = surgeDay ? Math.max(open, close) : Math.max(open, close) * (1 + upper * vol * 0.5); // 大涨日收在最高价（类似涨停）
    const low = Math.min(open, close) * (1 - random() * vol * 0.5);
    const volume = Math.round((stock ? 8e6 : 3e10) * (0.6 + random() * 0.9) * (surgeDay ? 2.2 : 1));
    const avg = (open + close + high + low) / 4;
    rows.push({ time: ymd(date), open: +open.toFixed(2), close: +close.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), volume, amount: Math.round(volume * avg), turnover: +(volume / 2.5e8 * 100).toFixed(2), avg: +avg.toFixed(2) });
  });
  return rows.filter((row) => row.time.replaceAll("-", "") >= String(begin).replaceAll("-", ""));
}

/** 分时：最近一个交易日 09:31 起，盘中到当前分钟、其余时间到 15:00；收盘价与日 K 最后一根一致。 */
function mockMinutes(windcode, now) {
  const daily = mockDaily(windcode, "20180101", now.day);
  const today = daily.at(-1);
  const prevClose = daily.at(-2)?.close ?? today.open;
  const [hh, mm] = now.time.split(":").map(Number);
  const minuteNow = hh * 60 + mm;
  const isToday = today.time.replaceAll("-", "") === now.day;
  const endMinute = isToday && minuteNow >= 571 && minuteNow < 900 ? (minuteNow > 690 && minuteNow < 781 ? 690 : minuteNow) : 900;
  const minutes = [];
  for (let m = 571; m <= endMinute; m += 1) if (m <= 690 || m >= 781) minutes.push(m);
  const random = seeded(`${windcode}:${today.time}`);
  const rows = [];
  let volume = 0;
  let amount = 0;
  minutes.forEach((m, index) => {
    const progress = minutes.length > 1 ? index / (minutes.length - 1) : 1;
    const target = today.open + (today.close - today.open) * progress;
    const price = index === minutes.length - 1 ? today.close : Math.min(today.high, Math.max(today.low, target + (random() - 0.5) * (today.high - today.low) * 0.3));
    const v = Math.round(today.volume / 240 * (0.5 + random()));
    volume += v;
    amount += v * price;
    const time = `${today.time} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
    rows.push([time, +(rows.at(-1)?.[2] ?? prevClose).toFixed(2), +price.toFixed(2), +Math.max(price, today.open).toFixed(2), +Math.min(price, today.open).toFixed(2), Math.round(v * price), v, 0, +(amount / volume).toFixed(2)]);
  });
  return rows;
}

// ── 板块资金（指数行情快照的主力资金字段）：按代码生成确定的数字，盘中随时间累积（数字是合成的）──
function hashCode(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}
function streakOf(test) {
  let count = 0;
  while (count < 20 && test(count)) count += 1;
  return count;
}
function mockSectorFlow(params, now) {
  const fields = String(params.indexes).split(",");
  const [hh, mm] = now.time.split(":").map(Number);
  const minute = hh * 60 + mm;
  const traded = minute <= 9 * 60 + 30 ? 0 : minute >= 15 * 60 ? 240 : Math.min(240, minute <= 11 * 60 + 30 ? minute - 570 : 120 + Math.max(0, minute - 780));
  const progress = traded / 240;
  const rows = String(params.windcode).split(",").map((code) => {
    const seed = hashCode(code);
    const base = ((seed % 41) - 18) * 1e8; // 每日基准净流入：−18 至 +22 亿
    const trend = ((seed >> 6) % 9 - 4) * 0.6e8; // 每天加速 / 减速
    const day = (back) => base - trend * back + (((seed >> (back % 12)) % 7) - 3) * 0.5e8;
    const sum = (from, to) => Array.from({ length: to - from }, (_, index) => day(from + index)).reduce((a, b) => a + b, 0);
    const today = day(0) * progress;
    const values = {
      "Wind代码": code,
      "最新交易日": now.day,
      "交易时间": `${now.day.slice(0, 4)}-${now.day.slice(4, 6)}-${now.day.slice(6)}T${now.time}.000+08:00`,
      "成交额": String(Math.round((60 + (seed % 140)) * 1e8 * Math.max(progress, 0.05))),
      "当日主力净流入额": String(Math.round(today)),
      "近5日主力净流入额": String(Math.round(today + sum(1, 5))),
      "近5日主力净流入天数": String([0, 1, 2, 3, 4].filter((back) => day(back) > 0).length),
      "近10日主力净流入额": String(Math.round(today + sum(1, 10))),
      "近20日主力净流入额": String(Math.round(today + sum(1, 20))),
      "近20日主力净流入天数": String(Array.from({ length: 20 }, (_, back) => back).filter((back) => day(back) > 0).length),
      "连红天数": String(day(0) > 0 ? streakOf((back) => day(back) > 0) : -streakOf((back) => day(back) <= 0)),
      "最新成交价": "1000"
    };
    return fields.map((name) => values[name] ?? null).concat(code);
  });
  return table([...fields, "Wind代码"], rows);
}

// ── 涨停情绪（/limitup，api/_lib/limitup/engine.js）：结构化涨停 / 跌停事件表、昨日涨停溢价、竞价溢价、个股资讯 ──
// 历史日涨停名单：所有历史口径必须走同一份，否则「昨日涨停溢价」会被引擎的口径护栏
// （返回值必须绝大多数命中昨日涨停名单）拒收，本地页面就看不到这条结论。
const historicalLimitUp = (day) => LIMIT_UP.slice(0, String(day).endsWith("1") ? 2 : 4);
// 北交所也放一只，否则「北交所空表」会触发引擎的空表重试等待
const LIMIT_EVENT = [...LIMIT_UP, ["920118.BJ", "北证样本", "商业航天;卫星导航"]];
const LIMIT_SEAL_TIMES = ["09:25:00", "09:31:12", "09:42:05", "09:58:40", "10:21:33", "13:12:09", "14:05:51", "14:48:20", "10:05:00"];
const LIMIT_DOWN_EVENT = [
  ["600001.SH", "样本跌停", "白酒;食品饮料"],
  ["600002.SH", "样本回落", "零售;百货"],
  ["300901.SZ", "创业跌停", "创新药;医药"],
  ["688901.SH", "科创跌停", "半导体;芯片"],
  ["920901.BJ", "北证跌停", "光伏;储能"]
];
const LIMIT_DOWN_TIMES = ["10:12:30", "13:41:02", "14:20:15", "11:05:44", "14:51:09"];
const SECTOR_TEST = { 沪深: () => true, 主板: (code) => /^(?:60|00)/.test(code), 创业板: (code) => /^30/.test(code), 科创板: (code) => /^68/.test(code), 北交所: (code) => /\.BJ$/.test(code) };
const isoClock = (day, clock) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${clock}+08:00`;

function mockLimitUp(serverType, toolName, question, now) {
  if (serverType === "stock_data" && toolName === "search_stocks") {
    const up = question.match(/^筛选(\d{8})涨停的(主板|创业板|科创板|北交所)A股并返回.*首次封板时间/);
    if (up) {
      const rows = LIMIT_EVENT.map((stock, index) => ({ stock, index })).filter(({ stock }) => SECTOR_TEST[up[2]](stock[0]))
        .map(({ stock: [code, name, concepts], index }) => [code, name, `全部A股;小市值;${concepts}`, isoClock(up[1], now.time), isoClock(up[1], LIMIT_SEAL_TIMES[index])]);
      return result({ data: [table(["Wind代码", "证券简称", "所属概念板块", "交易时间", "涨跌停时间"], rows)] });
    }
    const down = question.match(/^筛选(\d{8})跌停的(沪深|主板|创业板|科创板|北交所)A股并返回.*首次跌停时间/);
    if (down) {
      const day = down[1];
      const statusColumn = `${day.slice(0, 4)}年${Number(day.slice(4, 6))}月${Number(day.slice(6, 8))}日涨跌停状态`;
      const rows = LIMIT_DOWN_EVENT.map((stock, index) => ({ stock, index })).filter(({ stock }) => SECTOR_TEST[down[2]](stock[0]))
        .map(({ stock: [code, name, concepts], index }) => [code, name, "-1", concepts, isoClock(day, now.time), isoClock(day, LIMIT_DOWN_TIMES[index])]);
      return result({ data: [table(["Wind代码", "证券简称", statusColumn, "所属概念板块", "交易时间", "涨跌停时间"], rows)] });
    }
    const named = question.match(/^筛选(\d{8})收盘价等于当日涨停价的沪深A股并返回.*所属概念板块/);
    if (named) {
      return result({ data: [table(["Wind代码", "证券简称", "所属概念板块"], historicalLimitUp(named[1]).map(([code, name, concepts]) => [code, name, concepts]))] });
    }
  }
  if (serverType === "analytics_data" && toolName === "get_financial_data") {
    // 竞价溢价：用「开盘涨幅」列名，验证解析与分流
    const auction = question.match(/^(\d{8})涨停股票在(\d{8})的开盘涨幅$/);
    if (auction) {
      const rows = historicalLimitUp(auction[1]).map(([code, name], index) => [code, name, Number((3.4 - index * 2.2).toFixed(2))]);
      return result({ data: [table(["Wind代码", "证券简称", "开盘涨幅"], rows)] });
    }
  }
  if (serverType === "financial_docs" && toolName === "get_financial_news") {
    const target = question.match(/^(?:\d{8})?(.+?)(?:上涨原因|涨停原因)概念题材$/);
    if (target) {
      const stock = [...LIMIT_EVENT, ...LIMIT_DOWN_EVENT].find(([, name]) => name === target[1]);
      const date = `${now.day.slice(0, 4)}-${now.day.slice(4, 6)}-${now.day.slice(6, 8)}`;
      return result({ data: { items: stock ? [
        { title: `${stock[1]}涨停：${stock[2].split(";")[0]}方向获资金关注`, content: `${stock[1]}今日封板，市场关注其${stock[2].replaceAll(";", "、")}业务进展。`, date, source: "样例资讯", relevance: 0.88 }
      ] : [] } });
    }
  }
  return null;
}

export function mockWindResult(serverType, toolName, params) {
  const now = beijingNow();
  const qt = quoteTime();
  const question = String(params.question || params.query || "");

  const limitUp = mockLimitUp(serverType, toolName, question, now);
  if (limitUp) return limitUp;
  if (serverType === "index_data" && toolName === "get_index_price_indicators" && String(params.indexes || "").includes("主力净流入")) {
    return result({ data: [mockSectorFlow(params, now)] });
  }
  if (serverType === "index_data" && toolName === "get_index_price_indicators") {
    return result({ data: [table(
      ["Wind代码", "最新成交价", "涨跌幅", "成交额", "上涨家数", "下跌家数", "平盘家数", "交易时间"],
      [["881001.WI", 6123.45, 0.86, 1_235_000_000_000, 3312, 1876, 142, qt]]
    )] });
  }
  if (serverType === "index_data" && toolName === "get_index_kline" && !["000001.SH", "399001.SZ", "399006.SZ", "000688.SH"].includes(params.windcode)) {
    const rows = [];
    for (let offset = 100; offset >= 1; offset -= 1) {
      const date = new Date(Date.UTC(Number(now.day.slice(0, 4)), Number(now.day.slice(4, 6)) - 1, Number(now.day.slice(6, 8)) - offset));
      if ([0, 6].includes(date.getUTCDay())) continue;
      rows.push([date.toISOString().slice(0, 10).replaceAll("-", ""), 6000 + offset, 900_000_000_000 + offset * 3_000_000_000]);
    }
    return result({ data: [table(["TIME", "收盘价", "TURNOVER"], rows)] });
  }
  if (serverType === "index_data" && toolName === "get_index_technicals") {
    const [hh, mm] = qt.slice(9, 14).split(":").map(Number);
    const prevMinute = hh * 60 + mm - 5;
    const prev = `${now.day} ${String(Math.floor(prevMinute / 60)).padStart(2, "0")}:${String(prevMinute % 60).padStart(2, "0")}:00`;
    return result({ data: [table(
      ["Wind代码", "证券简称", "最新价格", "最新价格.交易时间", "5分前价格", "5分前价格.交易时间"],
      CONCEPTS.map(([code, name, , price, before]) => [code, name, price, `${qt.slice(0, 14)}:00`, before, prev])
    )] });
  }
  if (serverType === "stock_data" && toolName === "search_stocks") {
    if (/跌停/.test(question)) {
      return result({ data: [table(["Wind代码", "证券简称", "涨跌停状态", "交易时间"], [["600001.SH", "样本跌停", "跌停", qt]])] });
    }
    const historical = question.match(/筛选(\d{8})收盘价/);
    const rows = historical
      ? historicalLimitUp(historical[1]).map(([code, name]) => [code, name])
      : LIMIT_UP.map(([code, name], index) => [code, name, "涨停", qt, `${now.day} 10:${String(10 + index).padStart(2, "0")}:00`]);
    return result({ data: [table(historical ? ["Wind代码", "证券简称"] : ["Wind代码", "证券简称", "涨跌停状态", "交易时间", "涨停时间"], rows)] });
  }
  if (serverType === "analytics_data" && toolName === "get_financial_data") {
    if (/涨幅大于5%/.test(question)) return result({ data: [table(["统计口径", "涨幅大于5%股票家数"], [["沪深A股", 128]])] });
    if (/跌幅大于5%/.test(question)) return result({ data: [table(["统计口径", "跌幅大于5%股票家数"], [["沪深A股", 21]])] });
    // 昨日涨停溢价：名单与「昨日涨停名单」一致，涨停情绪引擎的口径护栏才会采信（短线情绪也用同一句）
    const premium = question.match(/^(\d{8})涨停股票在(\d{8})的最新涨跌幅/);
    if (premium) {
      const rows = historicalLimitUp(premium[1]).map(([code, name], index) => [code, name, Number((6.8 - index * 3.1).toFixed(2))]);
      return result({ data: [table(["Wind代码", "证券简称", "最新涨跌幅"], rows)] });
    }
    if (/概念指数涨跌幅排名前十/.test(question)) {
      return result({ data: [table(["Wind代码", "证券简称", "涨跌幅", "交易时间"], CONCEPTS.map(([code, name, change]) => [code, name, change, qt]))] });
    }
    const conceptOf = question.match(/^(\d{6}\.(?:SZ|SH))所属概念板块$/);
    if (conceptOf) {
      const stock = LIMIT_UP.find(([code]) => code === conceptOf[1]);
      return result({ data: [table(["Wind代码", "所属概念板块"], [[conceptOf[1], stock?.[2] || "其他"]])] });
    }
    if (/概念成分股最新涨跌幅排名前十/.test(question)) {
      const seed = question.length;
      const concept = question.split("概念成分股")[0];
      return result({ data: [table(
        ["Wind代码", "证券简称", "所属概念板块", "最新成交价", "今日开盘价", "今日最高价", "今日最低价", "涨跌幅", "成交额", "换手率", "量比", "交易时间"],
        [0, 1, 2, 3, 4].map((index) => [`301${seed % 10}${index}0.SZ`, `成分样本${index + 1}`, index === 4 ? "无关行业" : concept, 12.3 + index, 11.8, 12.6 + index, 11.6, 7.2 - index * 1.3, 8e8 - index * 1e8, 6.1 - index, 1.6, qt])
      )] });
    }
    return result({ data: [] });
  }
  // ── 个股技术分析（/technicalanalysis）用到的行情：日 K（period=10）、分时（begin=LAST）、个股快照 ──
  if (serverType === "stock_data" && toolName === "get_stock_price_indicators") {
    const stock = mockStock(params.windcode);
    if (!stock) return result({ data: table(["Wind代码", "中文简称"], []) });
    const days = mockDaily(stock.code, "20200101", now.day);
    const last = days.at(-1);
    const prev = days.at(-2);
    return result({ data: table(
      ["Wind代码", "中文简称", "最新成交价", "前收盘价", "今日开盘价", "今日最高价", "今日最低价", "成交量", "成交额", "涨跌", "涨跌幅", "换手率"],
      [[stock.code, stock.name, last.close, prev.close, last.open, last.high, last.low, last.volume, last.amount, +(last.close - prev.close).toFixed(2), +((last.close / prev.close - 1) * 100).toFixed(2), last.turnover]]
    ) });
  }
  if (serverType === "stock_data" && toolName === "get_stock_kline" && mockStock(params.windcode)?.failKline) {
    return { isError: true, content: [{ type: "text", text: "TOOL_RUNTIME_ERROR: 模拟失败" }] };
  }
  if ((serverType === "stock_data" && toolName === "get_stock_kline") || (serverType === "index_data" && toolName === "get_index_kline" && ["10", "1d"].includes(params.period))) {
    const rows = mockDaily(params.windcode, params.begin_date, params.end_date)
      .map((d) => [d.time, d.open, d.close, d.high, d.low, d.amount, d.volume, d.turnover, d.avg]);
    return result({ data: table(KLINE_COLUMNS, rows) });
  }
  if ((serverType === "stock_data" && toolName === "get_stock_quote") || (serverType === "index_data" && toolName === "get_index_quote")) {
    if (serverType === "stock_data" && process.env.WIND_MOCK_EMPTY_QUOTE === "1") return result({ data: table(KLINE_COLUMNS, []) });
    return result({ data: table(KLINE_COLUMNS, mockMinutes(params.windcode, now)) });
  }
  if (serverType === "financial_docs" && toolName === "get_company_announcements") {
    return result({ data: { items: [] } });
  }
  if (serverType === "financial_docs" && toolName === "get_financial_news") {
    return result({ data: { items: [
      { title: "工信部发布人形机器人产业支持政策", content: "政策明确支持人形机器人核心部件量产，减速器与丝杠订单有望增长。", date: `${now.day.slice(0, 4)}-${now.day.slice(4, 6)}-${now.day.slice(6, 8)}`, source: "Wind样例", relevance: 0.91 },
      { title: "光模块龙头订单饱满", content: "数据中心建设提速，CPO与光模块需求旺盛，订单增长。", date: `${now.day.slice(0, 4)}-${now.day.slice(4, 6)}-${now.day.slice(6, 8)}`, source: "Wind样例", relevance: 0.84 }
    ] } });
  }
  return result({ data: [] });
}
