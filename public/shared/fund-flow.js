// 首页与资金页共用的曲线、选线和配色。数据来自只读接口。
const COLORS = ['#3E6A8F', '#C9862F', '#B5533F', '#2F7C74', '#8A5FA8', '#6AA84F', '#A85B7C', '#B8962E', '#5A6E99', '#44707A', '#8B4A4A', '#3D7A5C'];
const valid = (v) => v != null && v !== '' && Number.isFinite(Number(v));
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const signed = (v, unit = '') => valid(v) ? `${Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : ''}${Math.abs(Number(v)).toFixed(1)}${unit}` : '—';
const day = (v) => String(v || '').replace(/\D/g, '').replace(/^\d{4}(\d{2})(\d{2})$/, '$1-$2');
export function flowColor(code) { let h = 0; for (const c of String(code)) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
export function flowDataset(data, period = 'today') {
  const source = period === 'today' ? data?.today : data?.windows?.[period];
  const lines = (source?.series || []).map((line) => ({ ...line, points: line.points || [] }));
  return { source, lines, keys: period === 'today' ? source?.samples || [] : source?.dates || [] };
}
export function selectFlowLines(lines, { metric = 'amount', period = 'today', compact = false, selected = [] } = {}) {
  const ranked = lines.map((line) => {
    const points = line.points.filter((p) => valid(p[metric]));
    const lastPoint = points.at(-1);
    const last = lastPoint?.[metric] ?? null;
    // 多日按整个区间净流入排序；占比采用 Σ净流入 / Σ成交额，而非百分数相加。
    const amounts = line.points.filter((p) => valid(p.amount));
    const net = amounts.reduce((sum, p) => sum + Number(p.amount), 0);
    const comparable = amounts.filter((p) => valid(p.turnover) && Number(p.turnover) > 0);
    const turnover = comparable.reduce((sum, p) => sum + Number(p.turnover), 0);
    const rank = period === 'today' ? last : metric === 'amount' ? net : turnover > 0 ? comparable.reduce((sum, p) => sum + Number(p.amount), 0) / turnover * 100 : last;
    return { ...line, last, rank, lastLabel: lastPoint?.label || lastPoint?.date };
  }).filter((line) => line.last != null).sort((a, b) => b.rank - a.rank);
  if (selected.length) return ranked.filter((line) => selected.includes(line.code));
  if (period !== 'today') {
    for (let i = ranked.length - 1; i >= 0; i--) {
      const points = ranked[i].points;
      if (points.some((p) => p.date) && new Set(points.filter((p) => valid(p[metric])).map((p) => p.date)).size !== Number(period)) ranked.splice(i, 1);
    }
  }
  return [...ranked.filter((line) => line.rank >= 0).slice(0, compact ? 3 : 6), ...ranked.filter((line) => line.rank < 0).slice(-(compact ? 3 : 4))];
}
const minute = (label) => { const [h, m] = String(label).split(':').map(Number); return h * 60 + m; };
const progress = (m) => Math.max(0, Math.min(120, m - 570)) + Math.max(0, Math.min(120, m - 780));

// 单调三次插值：经过真实采样点，转折处切线归零，避免曲线超调制造极值。
export function flowCurvePath(points) {
  if (!points.length) return '';
  const slopes = points.slice(1).map(([x, y], i) => (x === points[i][0] ? 0 : (y - points[i][1]) / (x - points[i][0])));
  const tangents = points.map((_, i) => i === 0 ? slopes[0] : i === points.length - 1 ? slopes.at(-1) : slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const dx = (x1 - x0) / 3;
    path += ` C${x0 + dx},${y0 + dx * tangents[i - 1]} ${x1 - dx},${y1 - dx * tangents[i]} ${x1},${y1}`;
  }
  return path;
}

// 纵轴整数刻度：步长取 1、2、5 × 10ⁿ（以及 25、250…），取刻度不超过 6 个的最小步长，一定包含 0。
// 纵轴范围按数据上下各留 6% 空白，不硬凑到整格，避免为了凑整把曲线压扁（例如最低只有 −2 却画到 −20）。
export function flowTicks(values, maxTicks = 6) {
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const pad = Math.max(max - min, 1) * .06;
  const lo = min < 0 ? min - pad : 0, hi = max > 0 ? max + pad : 0;
  const domainHi = hi > lo ? hi : lo + 1;
  const count = (step) => Math.floor(domainHi / step) - Math.ceil(lo / step) + 1;
  let step = 1;
  for (let pow = 1; count(step) > maxTicks; pow *= 10) {
    step = [1, 2, 2.5, 5].map((m) => m * pow).find((m) => Number.isInteger(m) && count(m) <= maxTicks) ?? 10 * pow;
  }
  // 数值都很小（不到 1 亿或 1%）时，范围放到 ±1，至少有 0 与一条整数刻度
  const low = count(step) < 3 && min < 0 ? Math.min(lo, -step) : lo;
  const high = count(step) < 3 && max > 0 ? Math.max(domainHi, step) : domainHi;
  const ticks = [];
  for (let v = Math.ceil(low / step) * step; v <= high + 1e-9; v += step) ticks.push(Math.round(v) || 0);
  return { lo: low, hi: high, ticks, step };
}

// 多日「累计」：从区间第一天起累加。金额＝逐日净流入相加；占比＝累计净流入 ÷ 累计成交额（不是百分数相加）。
// 缺失的日子不补零：线在那里断开，之后照样累加已知的日子（数据完整性校验通过才发布，正常不会缺）。
export function cumulativeLine(line, keys, metric) {
  const byDate = new Map(line.points.map((p) => [p.date, p]));
  let net = 0, turnover = 0, seen = false;
  const points = [];
  for (const date of keys) {
    const p = byDate.get(date);
    if (!p || !valid(p.amount)) continue;
    net += Number(p.amount);
    if (valid(p.turnover)) turnover += Number(p.turnover);
    seen = true;
    points.push({ date, amount: Math.round(net * 1e4) / 1e4, pct: metric === 'pct' && valid(p.turnover) && turnover > 0 ? Math.round(net / turnover * 1e5) / 1e3 : null });
  }
  const last = seen ? points.at(-1)[metric] : null;
  return { ...line, points, last: valid(last) ? Number(last) : null, lastLabel: points.at(-1)?.date };
}

// 右侧数值标签：先按真实位置往下推开，再从底部往上收，首尾都留在图内（原来整体上移会把最上面一条推出图外）。
export function placeFlowLabels(labels, { min, max, gap = 20 }) {
  labels.sort((a, b) => a.y - b.y);
  const step = Math.min(gap, (max - min) / Math.max(1, labels.length - 1));
  labels.forEach((item, i) => { item.y = Math.max(min, item.y, i ? labels[i - 1].y + step : min); });
  for (let i = labels.length - 1; i >= 0; i--) labels[i].y = Math.min(labels[i].y, i === labels.length - 1 ? max : labels[i + 1].y - step);
  return labels;
}

// 页面版用 CSS class 上色（跟随主题）；导出版把颜色直接写在属性上、字号放大，并去掉点选用的透明命中线与悬停标题，
// 导出时不依赖样式表、也没有 id / url(#…) 引用（短线情绪导出曾因 url(#id) 失效画成黑块）。
const PAGE_LOOK = { axis: 10, label: 10, stroke: 2, dot: 2, labelGap: 20, hit: true, titles: true, fixed: false, nameChars: (w) => (w < 400 ? 5 : 7), right: (w) => (w < 400 ? 105 : 135) };
const EXPORT_LOOK = { axis: 12, label: 12, stroke: 2.4, dot: 2.5, labelGap: 22, hit: false, titles: false, fixed: true, nameChars: () => 6, right: () => 150 };

/** 画曲线：返回整段 SVG 字符串。colors 为空时用 class（页面），否则把颜色写进属性（导出）。 */
export function flowChartSvg({ chosen, keys, period, metric, focusCode = '', width, height, look = PAGE_LOOK, colors = null }) {
  const unit = metric === 'amount' ? '亿' : '%';
  const paint = (kind, color) => {
    if (!colors) return kind === 'label' ? `class="ff-label" fill="${color}"` : `class="ff-${kind}"`;
    if (kind === 'grid') return `stroke="${colors.border}" stroke-dasharray="3 4"`;
    if (kind === 'zero') return `stroke="${colors.muted}" stroke-opacity=".6"`;
    if (kind === 'axis') return `fill="${colors.muted}" font-size="${look.axis}"`;
    return `fill="${color}" font-size="${look.label}" font-weight="600"`;
  };
  const values = chosen.flatMap((line) => line.points.map((p) => p[metric])).filter(valid).map(Number);
  const left = 42 + (look.axis - 10) * 2, right = look.right(width), top = 16, bottom = 34 + (look.axis - 10);
  const { lo, hi, ticks: yTicks } = flowTicks(values);
  const y = (v) => top + (hi - Number(v)) / (hi - lo) * (height - top - bottom);
  const keyOf = (p) => period === 'today' ? p.label : p.date;
  const x = (key) => left + (period === 'today' ? progress(minute(key)) / 240 : keys.length > 1 ? keys.indexOf(key) / (keys.length - 1) : .5) * (width - left - right);
  const svg = [];
  for (const v of yTicks) svg.push(`${v === 0 ? '' : `<line ${paint('grid')} x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"/>`}<text ${paint('axis')} x="${left - 7}" y="${y(v) + look.axis * .4}" text-anchor="end">${v < 0 ? `−${-v}` : v}</text>`);
  svg.push(`<line ${paint('zero')} x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"/>`);
  const ticks = period === 'today' ? ['09:30', '10:30', '13:00', '14:00', '15:00'] : keys.filter((_, i) => keys.length <= 5 || [0, Math.round((keys.length - 1) / 2), keys.length - 1].includes(i));
  ticks.forEach((key, i) => svg.push(`<text ${paint('axis')} x="${x(key)}" y="${height - 10}" text-anchor="${i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}">${period === 'today' ? key === '13:00' && width >= 400 ? '11:30/13:00' : key : day(key)}</text>`));
  const labels = [];
  for (const line of chosen) {
    const color = flowColor(line.code);
    // 按样本键分段，缺失值留下断点；不补造开盘零值，不跨缺口连线。
    const points = new Map(line.points.map((p) => [keyOf(p), p]));
    const segments = [[]];
    for (const key of keys) { const point = points.get(key); if (point && valid(point[metric])) segments.at(-1).push([x(key), y(point[metric])]); else if (segments.at(-1).length) segments.push([]); }
    const opacity = focusCode && focusCode !== line.code ? '.15' : '.95';
    svg.push(`<g data-code="${esc(line.code)}" opacity="${opacity}">${look.titles ? `<title>${esc(line.name)} ${signed(line.last, unit)}</title>` : ''}`);
    for (const segment of segments.filter((s) => s.length)) {
      const path = flowCurvePath(segment);
      svg.push(`<path d="${path} L${segment.at(-1)[0]},${y(0)} L${segment[0][0]},${y(0)} Z" fill="${color}" fill-opacity=".06" stroke="none"/><path d="${path}" fill="none" stroke="${color}" stroke-width="${look.stroke}"/>`);
      if (look.hit) svg.push(`<path d="${path}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/>`);
      segment.forEach(([px, py]) => svg.push(`<circle cx="${px}" cy="${py}" r="${look.dot}" fill="${color}" stroke="none"/>`));
    }
    svg.push('</g>');
    const last = line.points.filter((p) => valid(p[metric])).at(-1);
    labels.push({ line, y: y(last[metric]), color, opacity });
  }
  placeFlowLabels(labels, { min: top + 6, max: height - bottom - 4, gap: look.labelGap });
  labels.forEach((item) => svg.push(`<g data-code="${esc(item.line.code)}" opacity="${item.opacity}">${look.titles ? `<title>${esc(item.line.name)}</title>` : ''}<text ${paint('label', item.color)} x="${width - right + 8}" y="${item.y + look.label * .4}">${esc(item.line.name.slice(0, look.nameChars(width)))} ${signed(item.line.last, unit)}</text></g>`));
  const size = look.fixed ? ` width="${width}" height="${height}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"${size} role="img" aria-label="${esc(period === 'today' ? '盘中累计资金曲线' : `${period}日每日资金曲线`)}">${svg.join('')}</svg>`;
}

const PERIOD_LABEL = { today: '今天', 5: '近5日', 20: '近20日' };

export function mountFundFlow(root, { compact = false, initialCode = '', onSelect } = {}) {
  let data = null;
  let period = 'today';
  let metric = 'amount';
  let selected = initialCode ? [initialCode] : [];
  let focusCode = '';
  let mode = 'cum'; // 多日默认看累计（2026-10-24 与产品确认），可切换每日
  root.innerHTML = `${compact ? '' : `<div class="ff-controls"><div class="ff-segment" role="group" aria-label="资金周期">${[['today', '今天'], ['5', '5日'], ['20', '20日']].map(([v, label]) => `<button type="button" data-period="${v}" aria-pressed="${v === period}">${label}</button>`).join('')}</div><div class="ff-segment" role="group" aria-label="资金指标"><button type="button" data-metric="amount" aria-pressed="true">金额</button><button type="button" data-metric="pct" aria-pressed="false">占比</button></div><div class="ff-segment ff-mode" role="group" aria-label="多日口径" hidden><button type="button" data-mode="cum" aria-pressed="true">累计</button><button type="button" data-mode="daily" aria-pressed="false">每日</button></div></div>`}
    <p class="ff-caption"></p><div class="ff-chart" aria-live="polite"><p class="empty">读取资金数据中…</p></div><div class="ff-tip" role="status"></div><div class="ff-legend"></div>${compact ? '' : '<details class="ff-picker"><summary>选择板块</summary><div class="ff-options"></div><button class="ff-reset" type="button">恢复默认</button></details>'}<p class="ff-note"></p>`;
  const host = root.querySelector('.ff-chart');
  // 当前视图（页面与导出共用同一份计算，导出看到的就是页面上的选线、周期、指标与聚焦）。
  function view() {
    const { source, lines, keys } = flowDataset(data, period);
    const cumulative = period !== 'today' && mode === 'cum';
    const ranked = selectFlowLines(lines, { metric, period, compact, selected });
    // 选线与排序都按区间合计（与每日视图相同），累计只改变画法：终点＝区间合计＝右侧标签
    const chosen = cumulative ? ranked.map((line) => cumulativeLine(line, keys, metric)).filter((line) => line.last != null) : ranked;
    const end = period === 'today' ? source?.samples?.at(-1) : keys.at(-1);
    const date = period === 'today' ? day(source?.tradingDate) : day(end);
    const what = period === 'today' ? '盘中累计主力净流入' : `近${period}个交易日 · ${cumulative ? '累计' : '每日'}主力净流入`;
    const caption = `${what}${metric === 'pct' ? (cumulative ? ' / 累计成交额' : ' / 对应成交额') : ''} · 单位：${metric === 'amount' ? '亿元' : '%'}${end ? ` · ${date}${period === 'today' ? ` ${end}` : ''}` : ''}`;
    const incomplete = ranked.filter((line) => keys.some((key) => !line.points.some((p) => p.date === key && valid(p[metric === 'pct' && cumulative ? 'amount' : metric]))));
    const note = period === 'today' ? '按定时快照采样；缺失时点不补零。' : `按区间净流入强弱选线；${cumulative ? '从区间第一天起累计，右端标签为区间合计。' : '右端标签为最后一日数值。'}${data?.history?.status === 'pending' ? (data.history.asOf ? '新一期历史数据补齐中，暂展示上一完整版本。' : '历史日数据补齐中。') : data?.history?.status === 'partial' && data.history.pendingBoards ? `${data.history.pendingBoards}个板块历史数据补齐中，暂不显示。` : ''}${keys.length < Number(period) ? `当前仅有${keys.length}个交易日记录。` : ''}${incomplete.length ? `${incomplete.length}个板块历史数据未完整，缺失日期保留断点，等待补齐。` : ''}`;
    const hasValues = chosen.some((line) => line.points.some((p) => valid(p[metric])));
    return { source, lines, keys, chosen, caption, note, hasValues, date, end, cumulative };
  }
  function render() {
    const { lines, keys, chosen, caption, note, hasValues } = view();
    const unit = metric === 'amount' ? '亿' : '%';
    root.querySelector('.ff-caption').textContent = caption;
    root.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
    root.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === metric)));
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const modeGroup = root.querySelector('.ff-mode');
    if (modeGroup) modeGroup.hidden = period === 'today';
    root.querySelector('.ff-note').textContent = note;
    root.querySelector('.ff-legend').innerHTML = chosen.map((line) => `<button type="button" data-code="${esc(line.code)}" aria-pressed="${focusCode === line.code}"><i style="background:${flowColor(line.code)}"></i><span>${esc(line.name)}</span><b>${signed(line.last, unit)}</b></button>`).join('');
    const options = root.querySelector('.ff-options');
    if (options) options.innerHTML = lines.map((line) => `<label><input type="checkbox" value="${esc(line.code)}" ${selected.includes(line.code) ? 'checked' : ''}>${esc(line.name)}</label>`).join('');
    if (!hasValues) {
      host.innerHTML = `<p class="empty">${!lines.length ? (period !== 'today' && data?.history ? '历史日数据补齐中，通过完整性校验后统一展示。' : '暂无该周期资金数据，采样后更新。') : metric === 'pct' ? '所选板块暂无占比数据，可切换金额或恢复默认。' : '所选板块暂无有效数据，可恢复默认。'}</p>`;
      return;
    }
    const width = Math.max(280, host.clientWidth || 560);
    host.innerHTML = flowChartSvg({ chosen, keys, period, metric, focusCode, width, height: compact ? 250 : 320 });
    root.querySelector('.ff-tip').textContent = focusCode ? (() => { const line = chosen.find((item) => item.code === focusCode); return line ? `${line.name} · ${period === 'today' ? line.lastLabel : day(line.lastLabel)} · ${signed(line.last, unit)}` : ''; })() : '';
  }
  /** 分享小卡用：按导出宽度重新画一份（不克隆页面上的 SVG，避免按手机宽度画的图在导出里被放大、字变大变糊）。 */
  function snapshot({ width = 540, colors } = {}) {
    const { chosen, keys, caption, note, hasValues, date, end, cumulative } = view();
    if (!data || !hasValues) return null;
    const unit = metric === 'amount' ? '亿' : '%';
    const node = document.createElement('div');
    node.className = 'ff-export';
    node.innerHTML = `<div class="ff-export-chart">${flowChartSvg({ chosen, keys, period, metric, focusCode, width, height: 340, look: EXPORT_LOOK, colors })}</div>`
      + `<div class="ff-export-legend">${chosen.map((line) => `<div class="${focusCode && focusCode !== line.code ? 'is-dim' : ''}"><i style="background:${flowColor(line.code)}"></i><span>${esc(line.name)}</span><b>${signed(line.last, unit)}</b></div>`).join('')}</div>`
      + `<p class="ff-export-note">${esc(note)}</p>`;
    return { node, caption, period, metric, periodLabel: PERIOD_LABEL[period], modeLabel: period === 'today' ? '' : cumulative ? '累计' : '每日', metricLabel: metric === 'amount' ? '金额' : '占比', day: String(period === 'today' ? data?.today?.tradingDate || '' : keys.at(-1) || '').replace(/\D/g, ''), date, end, focus: chosen.find((line) => line.code === focusCode)?.name || '' };
  }
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-period], [data-metric], [data-mode]');
    if (button) { period = button.dataset.period || period; metric = button.dataset.metric || metric; mode = button.dataset.mode || mode; focusCode = ''; render(); return; }
    if (event.target.closest('.ff-reset')) { selected = []; focusCode = ''; render(); return; }
    const code = event.target.closest('[data-code]')?.dataset.code;
    if (code) { if (compact && onSelect) return onSelect(code); focusCode = focusCode === code ? '' : code; render(); }
  });
  root.addEventListener('change', (event) => {
    if (!event.target.matches('.ff-options input')) return;
    const checked = [...root.querySelectorAll('.ff-options input:checked')];
    if (checked.length > 10) { event.target.checked = false; root.querySelector('.ff-tip').textContent = '最多同时选择10个板块'; return; }
    selected = checked.map((input) => input.value);
    focusCode = ''; render();
  });
  let timer;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(render, 100); }) : null;
  observer?.observe(host);
  return { update(payload) { data = payload; render(); }, snapshot, destroy() { observer?.disconnect(); clearTimeout(timer); } };
}
