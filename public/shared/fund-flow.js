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

export function mountFundFlow(root, { compact = false, initialCode = '', onSelect } = {}) {
  let data = null;
  let period = 'today';
  let metric = 'amount';
  let selected = initialCode ? [initialCode] : [];
  let focusCode = '';
  root.innerHTML = `${compact ? '' : `<div class="ff-controls"><div class="ff-segment" role="group" aria-label="资金周期">${[['today', '今天'], ['5', '5日'], ['20', '20日']].map(([v, label]) => `<button type="button" data-period="${v}" aria-pressed="${v === period}">${label}</button>`).join('')}</div><div class="ff-segment" role="group" aria-label="资金指标"><button type="button" data-metric="amount" aria-pressed="true">金额</button><button type="button" data-metric="pct" aria-pressed="false">占比</button></div></div>`}
    <p class="ff-caption"></p><div class="ff-chart" aria-live="polite"><p class="empty">读取资金数据中…</p></div><div class="ff-tip" role="status"></div><div class="ff-legend"></div>${compact ? '' : '<details class="ff-picker"><summary>选择板块</summary><div class="ff-options"></div><button class="ff-reset" type="button">恢复默认</button></details>'}<p class="ff-note"></p>`;
  const host = root.querySelector('.ff-chart');
  function render() {
    const { source, lines, keys } = flowDataset(data, period);
    const chosen = selectFlowLines(lines, { metric, period, compact, selected });
    const unit = metric === 'amount' ? '亿' : '%';
    const end = period === 'today' ? source?.samples?.at(-1) : keys.at(-1);
    const date = period === 'today' ? day(source?.tradingDate) : day(end);
    root.querySelector('.ff-caption').textContent = `${period === 'today' ? '盘中累计主力净流入' : `近${period}个交易日 · 每日主力净流入`}${metric === 'pct' ? ' / 对应成交额' : ''} · 单位：${metric === 'amount' ? '亿元' : '%'}${end ? ` · ${date}${period === 'today' ? ` ${end}` : ''}` : ''}`;
    root.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
    root.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === metric)));
    const note = root.querySelector('.ff-note');
    const incomplete = chosen.filter((line) => keys.some((key) => !line.points.some((p) => p.date === key && valid(p[metric]))));
    note.textContent = period === 'today' ? '按定时快照采样；缺失时点不补零。' : `按区间净流入强弱选线；右端标签为最后一日数值。${data?.history?.status === 'pending' ? '新一期历史数据补齐中，暂展示上一完整版本。' : ''}${keys.length < Number(period) ? `当前仅有${keys.length}个交易日记录。` : ''}${incomplete.length ? `${incomplete.length}个板块历史数据未完整，缺失日期保留断点，等待补齐。` : ''}`;
    const values = chosen.flatMap((line) => line.points.map((p) => p[metric])).filter(valid).map(Number);
    root.querySelector('.ff-legend').innerHTML = chosen.map((line) => `<button type="button" data-code="${esc(line.code)}" aria-pressed="${focusCode === line.code}"><i style="background:${flowColor(line.code)}"></i><span>${esc(line.name)}</span><b>${signed(line.last, unit)}</b></button>`).join('');
    const options = root.querySelector('.ff-options');
    if (options) options.innerHTML = lines.map((line) => `<label><input type="checkbox" value="${esc(line.code)}" ${selected.includes(line.code) ? 'checked' : ''}>${esc(line.name)}</label>`).join('');
    if (!values.length) {
      host.innerHTML = `<p class="empty">${!lines.length ? (period !== 'today' && data?.history ? '历史日数据补齐中，通过完整性校验后统一展示。' : '暂无该周期资金数据，采样后更新。') : metric === 'pct' ? '所选板块暂无占比数据，可切换金额或恢复默认。' : '所选板块暂无有效数据，可恢复默认。'}</p>`;
      return;
    }
    const width = Math.max(280, host.clientWidth || 560);
    const height = compact ? 250 : 320;
    const left = 42, right = width < 400 ? 105 : 135, top = 16, bottom = 34;
    let lo = Math.min(0, ...values), hi = Math.max(0, ...values);
    const range = Math.max(hi - lo, 1); lo -= range * .1; hi += range * .1;
    const y = (v) => top + (hi - Number(v)) / (hi - lo) * (height - top - bottom);
    const keyOf = (p) => period === 'today' ? p.label : p.date;
    const x = (key) => left + (period === 'today' ? progress(minute(key)) / 240 : keys.length > 1 ? keys.indexOf(key) / (keys.length - 1) : .5) * (width - left - right);
    const svg = [];
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; svg.push(`<line class="ff-grid" x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"/><text class="ff-axis" x="${left - 7}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`); }
    svg.push(`<line class="ff-zero" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"/>`);
    const ticks = period === 'today' ? ['09:30', '10:30', '13:00', '14:00', '15:00'] : keys.filter((_, i) => keys.length <= 5 || [0, Math.round((keys.length - 1) / 2), keys.length - 1].includes(i));
    ticks.forEach((key, i) => svg.push(`<text class="ff-axis" x="${x(key)}" y="${height - 10}" text-anchor="${i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}">${period === 'today' ? key === '13:00' && width >= 400 ? '11:30/13:00' : key : day(key)}</text>`));
    const labels = [];
    for (const line of chosen) {
      const color = flowColor(line.code);
      // 按样本键分段，缺失值留下断点；不补造开盘零值，不跨缺口连线。
      const points = new Map(line.points.map((p) => [keyOf(p), p]));
      const segments = [[]];
      for (const key of keys) { const point = points.get(key); if (point && valid(point[metric])) segments.at(-1).push([x(key), y(point[metric])]); else if (segments.at(-1).length) segments.push([]); }
      const opacity = focusCode && focusCode !== line.code ? '.15' : '.95';
      svg.push(`<g data-code="${esc(line.code)}" opacity="${opacity}"><title>${esc(line.name)} ${signed(line.last, unit)}</title>`);
      for (const segment of segments.filter((s) => s.length)) {
        const path = flowCurvePath(segment);
        svg.push(`<path d="${path} L${segment.at(-1)[0]},${y(0)} L${segment[0][0]},${y(0)} Z" fill="${color}" opacity=".06"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2"/><path d="${path}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/>`);
        segment.forEach(([px, py]) => svg.push(`<circle cx="${px}" cy="${py}" r="2" fill="${color}"/>`));
      }
      svg.push('</g>');
      const last = line.points.filter((p) => valid(p[metric])).at(-1);
      labels.push({ line, y: y(last[metric]), color, opacity });
    }
    labels.sort((a, b) => a.y - b.y);
    const gap = Math.min(20, (height - top - bottom - 10) / Math.max(1, labels.length - 1));
    labels.forEach((l, i) => { l.y = Math.max(top + 6, l.y, i ? labels[i - 1].y + gap : 0); });
    const overflow = Math.max(0, labels.at(-1).y - (height - bottom - 4));
    labels.forEach((l) => { l.y -= overflow; svg.push(`<g data-code="${esc(l.line.code)}" opacity="${l.opacity}"><title>${esc(l.line.name)}</title><text class="ff-label" x="${width - right + 8}" y="${l.y + 4}" fill="${l.color}">${esc(l.line.name.slice(0, width < 400 ? 5 : 7))} ${signed(l.line.last, unit)}</text></g>`); });
    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(period === 'today' ? '盘中累计资金曲线' : `${period}日每日资金曲线`)}">${svg.join('')}</svg>`;
    root.querySelector('.ff-tip').textContent = focusCode ? (() => { const line = chosen.find((l) => l.code === focusCode); return line ? `${line.name} · ${period === 'today' ? line.lastLabel : day(line.lastLabel)} · ${signed(line.last, unit)}` : ''; })() : '';
  }
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-period], [data-metric]');
    if (button) { period = button.dataset.period || period; metric = button.dataset.metric || metric; focusCode = ''; render(); return; }
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
  return { update(payload) { data = payload; render(); }, destroy() { observer?.disconnect(); clearTimeout(timer); } };
}
