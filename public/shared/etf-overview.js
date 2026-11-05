export const etfNumber=(n,d=2)=>{if(n===null||n===undefined||!Number.isFinite(Number(n)))return '—';const value=Math.round(Number(n)*10**d)/10**d;return `${value>0?'+':''}${(Object.is(value,-0)?0:value).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d})}`;};
export const etfColor=n=>n>0?'ef-up':n<0?'ef-down':'';
export function etfOverviewMarkup(data){
 const t=data.total,last=t.points.find(p=>p.date===data.date)?.amount;
 const labels={day:'较昨日',week:'较近一周',month:'较近一月'};
 return `<div class="ef-overview-grid"><div class="ef-stat"><span>当日净流入</span><strong class="${etfColor(last)}">${etfNumber(last)}</strong><small>${t.fundCount} 只 ETF · 亿元</small></div>${Object.entries(labels).map(([key,label])=>{const c=t.comparison[key],value=c?.state==='missing'?'—':c.pct!=null?`${etfNumber(c.pct,1)}%`:`${etfNumber(c.delta)} 亿`;
 const note=c?.state==='missing'?'当前数据缺失':c.covered<c.expected?`有效样本 ${c.covered}/${c.expected} 只`:`基准 ${etfNumber(c.baseline)} 亿`;
 return `<div class="ef-stat"><span>${label}</span><strong class="${etfColor(c?.delta)}">${value}</strong><small>${note}</small></div>`;}).join('')}</div>`;
}
