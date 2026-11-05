const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MODES = { unlimited:'不限人数',limited:'限制人数',targeted:'定向人员' };
const STATUS = {active:'可兑换',full:'已兑满',expired:'已过期',disabled:'已停用'};
export const displayCode = code => String(code || '').match(/.{1,4}/g)?.join('-') || '';
const date = v => v ? new Date(v).toLocaleString('zh-CN',{hour12:false}) : '永久有效';
export function initRedemption({api,toast,confirmSheet,onChange}) {
 const form = $('#code-form'), dialog = $('#code-dialog'), detail = $('#code-detail-dialog');
 let rows = [], busy = false, createId, detailId, claims = [], listVersion = 0;
 async function request(action,payload={},post=false) {
  const query = new URLSearchParams({action:`redemption-${action}`,...(!post ? payload : {})});
  const result = await api(query.toString(),post ? {method:'POST',body:payload}:{});
  if (!result.ok) throw new Error(result.message || '操作失败，请稍后重试');
  return result;
 }
 function render() {
  $('#code-list').innerHTML = rows.length ? rows.map(r => `<article class="code-item"><div class="card-row"><h3>${esc(r.name)}</h3><span class="admin-pill muted">${STATUS[r.status] || ''}</span></div><code>${esc(displayCode(r.code))}</code><p class="admin-muted">${MODES[r.mode]} · 每人 ${r.amount} 分 · 已兑 ${r.claimed} / ${r.max_claims ?? '不限'} 人 · 已发 ${r.issued} 分</p><p class="admin-muted">创建 ${esc(date(r.created_at))} · 截止 ${esc(date(r.expires_at))}</p><div class="code-actions"><button type="button" class="btn-secondary" data-code-copy="${r.id}">复制兑换码</button><button type="button" class="btn-secondary" data-code-text="${r.id}">复制领取文案</button><button type="button" class="btn-secondary" data-code-detail="${r.id}">详情</button>${r.status === 'active' ? `<button type="button" class="btn-secondary" data-code-disable="${r.id}">停用</button>`:''}</div></article>`).join('') : '<p class="admin-muted">没有符合条件的兑换码</p>';
 }
 async function load(append=false) {
  const version = ++listVersion;
  $('#code-more').disabled = true;
  try {
   const payload={search:$('#code-search').value.trim(),mode:$('#code-mode-filter').value,status:$('#code-status-filter').value};
   if(append && rows.length) payload.before=rows.at(-1).created_at;
   const result=await request('list',payload);
   if(version!==listVersion) return;
   rows=append?[...rows,...result.rows]:result.rows;render();$('#code-more').hidden=result.rows.length<50;
  } catch(error) {toast(error.message,true);}
  finally {if(version===listVersion) $('#code-more').disabled=false;}
 }
 function modeChanged() {
  const mode=form.elements.mode.value;
  $('#code-limit-field').hidden=mode!=='limited';$('#code-count-field').hidden=mode!=='limited';$('#code-email-field').hidden=mode!=='targeted';
  form.elements.maxClaims.required=mode==='limited';form.elements.maxClaims.disabled=mode!=='limited';
  form.elements.emails.required=mode==='targeted';form.elements.emails.disabled=mode!=='targeted';
 }
 $('#code-new').addEventListener('click',()=>{form.reset();createId=crypto.randomUUID();modeChanged();$('#code-error').hidden=true;dialog.showModal();form.elements.name.focus();});
 $('#code-close').addEventListener('click',()=>dialog.close());
 $('#code-detail-close').addEventListener('click',()=>detail.close());
 form.elements.mode.addEventListener('change',modeChanged);
 $('#code-amounts').addEventListener('click',event=>{const n=event.target.closest('[data-code-amount]')?.dataset.codeAmount;if(n)form.elements.amount.value=n;});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  busy=true;$('#code-create').disabled=true;$('#code-error').hidden=true;
  try {
   const e=form.elements,mode=e.mode.value;
   const emails=[...new Set(e.emails.value.split(/[\s,;，；]+/).map(s=>s.trim().toLowerCase()).filter(Boolean))];
   if(mode==='targeted' && (!emails.length || emails.length>500 || emails.some(s=>s.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))) throw new Error('请填写有效邮箱，每行一个，最多 500 个');
   const payload={id:createId,name:e.name.value.trim(),mode,amount:Number(e.amount.value),maxClaims:mode==='limited'?Number(e.maxClaims.value):null,showCount:e.showCount.checked,emails:mode==='targeted'?emails:[],expiresAt:e.expiresAt.value?new Date(e.expiresAt.value).toISOString():null,note:e.note.value.trim()};
   const result=await request('create',payload,true);
   dialog.close();toast('兑换码已生成');await load();await showDetail(result.code.id);onChange();
  }catch(error){$('#code-error').textContent=error.message;$('#code-error').hidden=false;}
  finally{busy=false;$('#code-create').disabled=false;}
 });
 $('#code-filter').addEventListener('submit',e=>{e.preventDefault();load();});
 $('#code-more').addEventListener('click',()=>load(true));
 function drawDetail(result) {
  const c=result.code;
  $('#code-detail').innerHTML=`<div class="code-detail-meta"><h3>${esc(c.name)}</h3><code>${esc(displayCode(c.code))}</code><p>${MODES[c.mode]} · 每人 ${c.amount} 分 · 已兑 ${c.claimed} / ${c.max_claims ?? '不限'} 人 · 已发 ${c.claimed*c.amount} 分</p><p>创建 ${esc(date(c.created_at))} · 创建人 ${esc(c.creatorCode || '—')}</p><p>截止 ${esc(date(c.expires_at))}${c.disabled_at ? ` · 停用 ${esc(date(c.disabled_at))}`:''}</p>${c.note?`<p>内部备注：${esc(c.note)}</p>`:''}</div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户 / 邮箱</th><th>积分 / 流水</th><th>时间</th></tr></thead><tbody>${claims.length?claims.map(r=>`<tr><th>${esc(r.user_code)}<small>${esc(r.email)}</small></th><td>${r.amount}<small>#${r.ledger_id}</small></td><td>${esc(date(r.created_at))}</td></tr>`).join(''):'<tr><td colspan="3">暂无兑换记录</td></tr>'}</tbody></table></div>${result.targets.length?`<details class="admin-details"><summary>定向名单（${result.targets.filter(r=>r.claimed).length} / ${result.targets.length} 已兑换）</summary>${result.targets.map(r=>`<p class="admin-muted">${esc(r.email)} · ${r.claimed?'已兑换':'未兑换'}</p>`).join('')}</details>`:''}`;
 }
 async function showDetail(id,append=false) {
  detailId=id;
  if(!detail.open) detail.showModal();
  if(!append) {$('#code-detail').textContent='读取中…';$('#code-claims-more').hidden=true;}
  try {
   const result=await request('detail',{id,...(append && claims.length ? {before:claims.at(-1).id}:{})});
   if(detailId!==id) return;
   claims=append?[...claims,...result.claims]:result.claims;drawDetail(result);$('#code-claims-more').hidden=result.claims.length<50;
  }catch(error){$('#code-detail').textContent=error.message;toast(error.message,true);}
 }
 $('#code-claims-more').addEventListener('click',async()=>{const b=$('#code-claims-more');b.disabled=true;try{await showDetail(detailId,true);}finally{b.disabled=false;}});
 $('#code-list').addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  const id=b.dataset.codeCopy || b.dataset.codeText || b.dataset.codeDetail || b.dataset.codeDisable;
  const r=rows.find(x=>x.id===id);if(!r)return;
  b.disabled=true;
  try{
   if(b.dataset.codeDetail) await showDetail(id);
   else if(b.dataset.codeDisable){
    if(await confirmSheet('停用这个兑换码？', [['活动',r.name],['已兑换',`${r.claimed} 人（已到账积分保留）`]],'确认停用')){await request('disable',{id},true);toast('兑换码已停用');await load();}
   }else{
    const code=displayCode(r.code);
    const text=b.dataset.codeText?`${r.name}：在个人中心「积分兑换」输入 ${code}，可领取 ${r.amount} 积分，每人限领一次。${r.mode==='limited'?`限前 ${r.max_claims} 人。`:r.mode==='targeted'?'仅限指定邮箱账号领取。':''}${r.expires_at?`截止 ${date(r.expires_at)}。`:''}`:code;
    await navigator.clipboard.writeText(text);toast('已复制');
   }
  }catch(error){toast(error.message,true);}finally{b.disabled=false;}
 });
 return {load};
}
