// 管理后台 · 兑换码管理：生成（短码 / 自定义口令、领取对象、截止快捷选项、发放上限提示）、
// 分享（卡片图片、领取文案、领取链接、兑换码）、列表、详情与停用；总览的「兑换码」卡片也在这里读取。
import { displayCode, redeemLink, shareText, ruleChips, dateText, copyText, qrSvg, AUDIENCE } from "/shared/redeem-code.js?v=1";

const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MODES = { unlimited: '不限人数', limited: '限制人数', targeted: '定向人员' };
const STATUS = { active: '可兑换', full: '已兑满', expired: '已过期', disabled: '已停用' };
const EXPORT_WIDTH = 360;
export { displayCode };
const number = n => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('zh-CN');
const date = v => v ? dateText(v) : '长期有效';
const pad = n => String(n).padStart(2, '0');

/** datetime-local 的值（北京时间）：today → 今天 23:59，数字 → N 天后的 23:59。 */
export function expiryValue(choice, now = new Date()) {
 if (choice === '') return '';
 const days = choice === 'today' ? 0 : Number(choice);
 const sh = new Date(now.getTime() + 8 * 3600_000); // 北京时间的年月日
 const target = new Date(Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate() + days));
 return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T23:59`;
}
/** datetime-local 的值按北京时间解读成 ISO 时间。 */
export const shanghaiIso = value => value ? new Date(`${value}:00+08:00`).toISOString() : null;

/** 发放上限提示：限制人数 / 定向 = 名额 × 每人积分；不限人数提示风险。 */
export function budgetText({ mode, amount, maxClaims, emails, expiresAt }) {
 const each = Number(amount);
 if (!Number.isInteger(each) || each < 1) return { text: '', warn: false };
 if (mode === 'unlimited') return { text: expiresAt ? `不限人数：链接外传后无法控制发放总量，截止前每位用户都可领 ${each} 分。` : `不限人数且长期有效：链接外传后发放总量没有上限。建议设截止时间或改为限制人数。`, warn: true };
 const seats = mode === 'targeted' ? emails : Number(maxClaims);
 if (!Number.isInteger(seats) || seats < 1) return { text: '', warn: false };
 return { text: `最多发出 ${number(seats)} 人 × ${number(each)} 分 = ${number(seats * each)} 分`, warn: false };
}

export function initRedemption({ api, toast, confirmSheet, onChange }) {
 const form = $('#code-form'), dialog = $('#code-dialog'), detail = $('#code-detail-dialog'), share = $('#code-share-dialog');
 let rows = [], busy = false, riskAcknowledged = false, createId, detailId, detailCode = null, claims = [], listVersion = 0, codeStyle = 'short', sharing = null, cardBlob = null, cardPromise = null;
 async function request(action, payload = {}, post = false) {
  const query = new URLSearchParams({ action: `redemption-${action}`, ...(!post ? payload : {}) });
  const result = await api(query.toString(), post ? { method: 'POST', body: payload } : {});
  if (!result.ok) throw new Error(result.message || '操作失败，请稍后重试');
  return result;
 }

 // ── 列表 ──
 function progress(r) {
  if (r.max_claims == null) return `<p class="admin-muted">已领 ${number(r.claimed)} 人 · 已发 ${number(r.issued)} 分</p>`;
  const pct = Math.min(100, Math.round(100 * r.claimed / r.max_claims));
  return `<div class="code-progress" role="img" aria-label="已领 ${r.claimed} / ${r.max_claims}"><i style="width:${pct}%"></i></div><p class="admin-muted">已领 ${number(r.claimed)} / ${number(r.max_claims)} 人 · 已发 ${number(r.issued)} 分</p>`;
 }
 function render() {
  $('#code-list').innerHTML = rows.length ? rows.map(r => `<article class="code-item${r.status === 'active' ? '' : ' is-closed'}"><div class="card-row"><h3>${esc(r.name)}</h3><span class="admin-pill${r.status === 'active' ? '' : ' muted'}">${STATUS[r.status] || ''}</span></div><p class="code-line"><code>${esc(displayCode(r.code))}</code><span>${MODES[r.mode]} · 每人 ${r.amount} 分${AUDIENCE[r.audience] ? ` · ${AUDIENCE[r.audience]}` : ''}</span></p>${progress(r)}<p class="admin-muted">创建 ${esc(dateText(r.created_at))} · ${r.expires_at ? `${esc(dateText(r.expires_at))} 截止` : '长期有效'}</p><div class="code-actions">${r.status === 'active' ? `<button type="button" class="btn-primary" data-code-share="${r.id}">分享</button>` : ''}<button type="button" class="btn-secondary" data-code-detail="${r.id}">详情</button>${r.status === 'active' ? `<button type="button" class="btn-secondary" data-code-disable="${r.id}">停用</button>` : ''}</div></article>`).join('') : '<p class="admin-muted">没有符合条件的兑换码</p>';
 }
 async function load(append = false) {
  const version = ++listVersion;
  $('#code-more').disabled = true;
  try {
   const payload = { search: $('#code-search').value.trim(), mode: $('#code-mode-filter').value, status: $('#code-status-filter').value };
   if (append && rows.length) payload.before = rows.at(-1).created_at;
   const result = await request('list', payload);
   if (version !== listVersion) return;
   rows = append ? [...rows, ...result.rows] : result.rows; render(); $('#code-more').hidden = result.rows.length < 50;
  } catch (error) { toast(error.message, true); }
  finally { if (version === listVersion) $('#code-more').disabled = false; }
 }

 // ── 总览卡片 ──
 async function loadStats() {
  try {
   const s = await request('stats');
   $('#codes-active').textContent = number(s.active);
   $('#codes-users-today').textContent = number(s.today?.users);
   $('#codes-points-today').textContent = s.today ? `+${number(s.today.points)}` : '—';
   $('#codes-users-week').textContent = number(s.week?.users);
   $('#codes-points-week').textContent = s.week ? `+${number(s.week.points)}` : '—';
   $('#codes-total').textContent = `累计领取 ${number(s.total?.claims)} 次，发出 ${number(s.total?.points)} 分。`;
  } catch {
   $('#codes-total').textContent = '兑换码统计暂不可用（数据库更新后显示）。';
  }
 }

 // ── 生成 ──
 function modeChanged() {
  const mode = form.elements.mode.value;
  $('#code-limit-field').hidden = mode !== 'limited'; $('#code-count-field').hidden = mode !== 'limited'; $('#code-email-field').hidden = mode !== 'targeted';
  $('#code-audience-field').hidden = mode === 'targeted';
  form.elements.maxClaims.required = mode === 'limited'; form.elements.maxClaims.disabled = mode !== 'limited';
  form.elements.emails.required = mode === 'targeted'; form.elements.emails.disabled = mode !== 'targeted';
  updateBudget();
 }
 function parseEmails() {
  const list = [...new Set(form.elements.emails.value.split(/[\s,;，；]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter(s => s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return { list, bad };
 }
 function updateBudget() {
  const e = form.elements, mode = e.mode.value;
  const { list, bad } = parseEmails();
  if (mode === 'targeted') $('#code-email-count').textContent = list.length ? `已识别 ${list.length} 个${bad.length ? `，${bad.length} 个格式不对：${bad.slice(0, 3).join('、')}${bad.length > 3 ? '…' : ''}` : ''}` : '每行一个，最多 500 个';
  const { text, warn } = budgetText({ mode, amount: Number(e.amount.value), maxClaims: Number(e.maxClaims.value), emails: list.length - bad.length, expiresAt: e.expiresAt.value });
  const line = $('#code-budget');
  line.textContent = text; line.hidden = !text; line.classList.toggle('warn', warn);
  riskAcknowledged = false; $('#code-create').textContent = '确认生成';
 }
 function setStyle(style) {
  codeStyle = style;
  form.querySelectorAll('[data-code-style]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.codeStyle === style)));
  form.elements.customCode.hidden = style !== 'custom'; form.elements.customCode.required = style === 'custom';
  if (style === 'custom') form.elements.customCode.focus();
 }
 $('#code-new').addEventListener('click', () => { form.reset(); createId = crypto.randomUUID(); setStyle('short'); form.elements.expiresAt.value = expiryValue('7'); modeChanged(); $('#code-error').hidden = true; dialog.showModal(); form.elements.name.focus(); });
 $('#code-close').addEventListener('click', () => dialog.close());
 $('#code-detail-close').addEventListener('click', () => detail.close());
 $('#code-share-close').addEventListener('click', () => share.close());
 form.elements.mode.addEventListener('change', modeChanged);
 form.addEventListener('input', updateBudget);
 form.querySelectorAll('[data-code-style]').forEach(b => b.addEventListener('click', () => setStyle(b.dataset.codeStyle)));
 form.elements.customCode.addEventListener('input', () => { const i = form.elements.customCode; i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
 $('#code-amounts').addEventListener('click', event => { const n = event.target.closest('[data-code-amount]')?.dataset.codeAmount; if (n) { form.elements.amount.value = n; updateBudget(); } });
 $('#code-expiry').addEventListener('click', event => { const b = event.target.closest('[data-expiry]'); if (b) { form.elements.expiresAt.value = expiryValue(b.dataset.expiry); updateBudget(); } });
 form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  $('#code-error').hidden = true;
  try {
   const e = form.elements, mode = e.mode.value;
   const { list, bad } = parseEmails();
   if (mode === 'targeted' && (!list.length || list.length > 500 || bad.length)) throw new Error('请填写有效邮箱，每行一个，最多 500 个');
   const custom = codeStyle === 'custom' ? e.customCode.value.trim() : '';
   if (codeStyle === 'custom' && !/^[A-Z0-9]{6,16}$/.test(custom)) throw new Error('口令需为 6–16 位字母或数字');
   // 不限人数且长期有效：第一次按下只提示风险，再按一次才生成（弹窗里不能再叠一层确认框）
   const risky = mode === 'unlimited' && !e.expiresAt.value;
   if (risky && !riskAcknowledged) { riskAcknowledged = true; $('#code-create').textContent = '仍然生成'; throw new Error('不限人数且长期有效：链接外传后发放总量没有上限。确定的话再按一次「仍然生成」。'); }
   busy = true; $('#code-create').disabled = true;
   const payload = { id: createId, name: e.name.value.trim(), mode, amount: Number(e.amount.value), maxClaims: mode === 'limited' ? Number(e.maxClaims.value) : null, showCount: e.showCount.checked, emails: mode === 'targeted' ? list : [], expiresAt: shanghaiIso(e.expiresAt.value), note: e.note.value.trim(), audience: mode === 'targeted' ? 'all' : e.audience.value, ...(custom ? { customCode: custom } : { codeStyle: 'short' }) };
   const result = await request('create', payload, true);
   dialog.close(); toast('兑换码已生成'); await load(); onChange();
   openShare({ ...result.code, status: 'active' });
  } catch (error) { $('#code-error').textContent = error.message; $('#code-error').hidden = false; }
  finally { busy = false; $('#code-create').disabled = false; }
 });
 $('#code-filter').addEventListener('submit', e => { e.preventDefault(); load(); });
 $('#code-more').addEventListener('click', () => load(true));

 // ── 分享：卡片图片、文案、链接、兑换码 ──
 function openShare(code) {
  sharing = code; cardBlob = null; cardPromise = null;
  $('#cc-amount').textContent = String(code.amount);
  $('#cc-name').textContent = code.name;
  $('#cc-rules').innerHTML = ruleChips(code).filter(c => c !== '每人限领一次').map(c => `<li>${esc(c)}</li>`).join('');
  $('#cc-code').textContent = displayCode(code.code);
  $('#cc-code').classList.toggle('long', displayCode(code.code).length > 12);
  $('#cc-qr').innerHTML = qrSvg(redeemLink(code.code));
  $('#share-preview').textContent = shareText(code);
  $('#share-status').hidden = true;
  if (!share.open) share.showModal();
  if (window.htmlToImage) cardPromise = buildCard().then(b => (cardBlob = b)).catch(() => null);
 }
 async function buildCard() {
  if (!window.htmlToImage) throw new Error('图片组件尚未加载完成，请稍后再试');
  const host = document.createElement('div');
  host.className = 'code-export-host';
  const card = $('#code-card').cloneNode(true);
  card.removeAttribute('id'); card.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  card.style.width = `${EXPORT_WIDTH}px`;
  host.append(card); document.body.append(host);
  try {
   for (const image of card.querySelectorAll('img')) {
    const blob = await (await fetch(image.src)).blob();
    image.src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
   }
   await new Promise(r => setTimeout(r, 60));
   const blob = await window.htmlToImage.toBlob(card, { width: EXPORT_WIDTH, height: Math.ceil(card.getBoundingClientRect().height), pixelRatio: 3, backgroundColor: getComputedStyle(card).backgroundColor, skipFonts: true });
   if (!blob) throw new Error('浏览器未能生成图片');
   return blob;
  } finally { host.remove(); }
 }
 // 分享弹窗是模态的，页面底部的轻提示会被遮住：结果写在弹窗里
 let statusTimer = null;
 function shareStatus(message, error = false) {
  const line = $('#share-status');
  line.textContent = message; line.classList.toggle('error', error); line.hidden = false;
  clearTimeout(statusTimer); statusTimer = setTimeout(() => { line.hidden = true; }, 2600);
 }
 async function copyWith(text, label) { const ok = await copyText(text); shareStatus(ok ? `已复制${label}` : '复制失败，请手动选取下方文字', !ok); }
 $('#share-text').addEventListener('click', () => sharing && copyWith(shareText(sharing), '领取文案'));
 $('#share-link').addEventListener('click', () => sharing && copyWith(redeemLink(sharing.code), '领取链接'));
 $('#share-code').addEventListener('click', () => sharing && copyWith(displayCode(sharing.code), '兑换码'));
 $('#share-image').addEventListener('click', async () => {
  if (!sharing) return;
  const button = $('#share-image'); button.disabled = true; button.textContent = '生成中…';
  try {
   const blob = cardBlob || await (cardPromise && await cardPromise) || await buildCard();
   const name = `兑换码-${sharing.name.replace(/[\\/:*?"<>|\s]+/g, '')}-${sharing.code}.png`;
   const file = new File([blob], name, { type: 'image/png' });
   if (navigator.canShare?.({ files: [file] }) && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) await navigator.share({ files: [file], title: sharing.name }).catch(() => {});
   else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); shareStatus('卡片图片已保存'); }
  } catch (error) { shareStatus(error.message || '生成图片失败，请重试', true); }
  finally { button.disabled = false; button.textContent = '保存卡片图片'; }
 });

 // ── 详情 ──
 function drawDetail(result) {
  const c = result.code; detailCode = c;
  const closed = c.disabled_at || (c.expires_at && new Date(c.expires_at) <= new Date()) || (c.max_claims != null && c.claimed >= c.max_claims);
  $('#code-detail').innerHTML = `<div class="code-detail-meta"><h3>${esc(c.name)}</h3><code>${esc(displayCode(c.code))}</code><p>${MODES[c.mode]} · 每人 ${c.amount} 分${AUDIENCE[c.audience] ? ` · ${AUDIENCE[c.audience]}` : ''} · 已领 ${c.claimed} / ${c.max_claims ?? '不限'} 人 · 已发 ${number(c.claimed * c.amount)} 分</p><p>创建 ${esc(date(c.created_at))} · 创建人 ${esc(c.creatorCode || '—')}</p><p>${c.expires_at ? `${esc(date(c.expires_at))} 截止` : '长期有效'}${c.disabled_at ? ` · ${esc(date(c.disabled_at))} 停用` : ''}</p>${c.note ? `<p>内部备注：${esc(c.note)}</p>` : ''}${closed ? '' : '<button type="button" class="btn-primary" data-detail-share>分享</button>'}</div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户 / 邮箱</th><th>积分 / 流水</th><th>时间</th></tr></thead><tbody>${claims.length ? claims.map(r => `<tr><th>${esc(r.user_code)}<small>${esc(r.email)}</small></th><td>${r.amount}<small>#${r.ledger_id}</small></td><td>${esc(date(r.created_at))}</td></tr>`).join('') : '<tr><td colspan="3">暂无兑换记录</td></tr>'}</tbody></table></div>${result.targets.length ? `<details class="admin-details"><summary>定向名单（${result.targets.filter(r => r.claimed).length} / ${result.targets.length} 已兑换）</summary>${result.targets.map(r => `<p class="admin-muted">${esc(r.email)} · ${r.claimed ? '已兑换' : '未兑换'}</p>`).join('')}</details>` : ''}`;
 }
 async function showDetail(id, append = false) {
  detailId = id;
  if (!detail.open) detail.showModal();
  if (!append) { $('#code-detail').textContent = '读取中…'; $('#code-claims-more').hidden = true; }
  try {
   const result = await request('detail', { id, ...(append && claims.length ? { before: claims.at(-1).id } : {}) });
   if (detailId !== id) return;
   claims = append ? [...claims, ...result.claims] : result.claims; drawDetail(result); $('#code-claims-more').hidden = result.claims.length < 50;
  } catch (error) { $('#code-detail').textContent = error.message; toast(error.message, true); }
 }
 $('#code-detail').addEventListener('click', event => { if (event.target.closest('[data-detail-share]') && detailCode) { detail.close(); openShare(detailCode); } });
 $('#code-claims-more').addEventListener('click', async () => { const b = $('#code-claims-more'); b.disabled = true; try { await showDetail(detailId, true); } finally { b.disabled = false; } });
 $('#code-list').addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  const id = b.dataset.codeShare || b.dataset.codeDetail || b.dataset.codeDisable;
  const r = rows.find(x => x.id === id); if (!r) return;
  if (b.dataset.codeShare) return openShare(r);
  b.disabled = true;
  try {
   if (b.dataset.codeDetail) await showDetail(id);
   else if (await confirmSheet('停用这个兑换码？', [['活动', r.name], ['已兑换', `${r.claimed} 人（已到账积分保留）`]], '确认停用')) { await request('disable', { id }, true); toast('兑换码已停用'); await load(); onChange(); }
  } catch (error) { toast(error.message, true); } finally { b.disabled = false; }
 });
 return { load, loadStats };
}
