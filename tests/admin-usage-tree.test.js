import { describe, it, expect } from 'vitest';
import { buildUsageTree, visibleUsageNodes, usageRowsHtml, actionLabel } from '../public/admin/usage-tree.js';
const event = (feature, action, source='browser', extra={}) => ({feature,action,source,today:2,usersToday:1,week:8,users7d:3,anonymous7d:2,...extra});
const find = (tree,id) => { for (const node of tree) { if (node.id===id) return node; const nested=find(node.children,id); if(nested) return nested; } };
describe('用户路径统计层级', () => {
  it('orders entry, login and home and nests boards, content details and personal functions', () => {
    const tree=buildUsageTree([]);
    expect(tree.map(x=>x.id)).toEqual(['about','login','home']);
    expect(find(tree,'home').children.map(x=>x.id)).toEqual(['boards','account','legal']);
    expect(find(tree,'boards').children.map(x=>x.id)).toEqual(['shortemotion','technicalanalysis','sectorflow','etfflow','limitup','kandian']);
    expect(find(tree,'shortemotion').children[0].id).toBe('anomalies');
    expect(find(tree,'kandian').children[0].id).toBe('article');
    expect(find(tree,'account').children.map(x=>x.id)).toContain('signin');
  });
  it('keeps page views separate from attempts/results and does not sum distinct users', () => {
    const page=event('technicalanalysis','page_view'), click=event('technicalanalysis','click:ta-run'), api=event('technicalanalysis','analysis_run','api',{success:5,failure:3});
    const tree=buildUsageTree([page,click,api]);
    const node=find(tree,'technicalanalysis');
    expect(node.metric).toBe(page); expect(node.metric.users7d).toBe(3);
    expect(node.children.map(x=>x.metric)).toEqual([api,click]);
    expect(find(tree,'boards').metric).toBeNull(); expect(find(tree,'home').metric).toBeNull();
  });
  it('retains unknown historical events, exact zeroes and sources', () => {
    const tree=buildUsageTree([event('future','click:button'),event('home','page_view','browser',{today:0,usersToday:0})]);
    expect(find(tree,'other').children[0].id).toBe('future');
    expect(usageRowsHtml(tree,new Set())).toContain('0 / 0');
    expect(find(tree,'future').children[0].metric.source).toBe('browser');
  });
  it('expands only descendants of expanded nodes, retaining source results and escaping labels', () => {
    const tree=buildUsageTree([event('limitup','unlock','api',{success:1,failure:1}),event('limitup','click:<img src=x>')]);
    expect(visibleUsageNodes(tree,new Set()).map(n=>n.id)).toEqual(['about','login','home']);
    const expanded=new Set(['home','boards','limitup']);
    const html=usageRowsHtml(tree,expanded);
    expect(html).toContain('aria-expanded="true"'); expect(html).toContain('成功 1 · 失败 1');
    expect(html).toContain('&lt;img src=x&gt;'); expect(html).not.toContain('<img');
  });
  it('names route destinations without pretending legacy generic navigation knows its target', () => {
    expect(actionLabel('click:to-limitup')).toBe('进入涨停情绪');
    expect(actionLabel('click:navigation')).toContain('历史未区分去向');
    expect(actionLabel('report_view')).toBe('查看已有报告');
  });
});
