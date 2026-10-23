import { refreshHistory } from './history.js';
import { isExcludedBoard } from './boards.js';
// 只读已有板块清单与快照，不重跑整个情绪模块，也不增加行情快照调用。
export async function refreshStoredHistory(store, options = {}) {
  const latest = (await store.kvGet('sectorflow:latest'))?.value;
  if (!latest?.tradingDate) return { skipped: true, reason: '尚无行情快照' };
  const list = (await store.kvGet('sectorflow:boards'))?.value?.boards || [];
  const merged = new Map((latest.boards || []).map((b) => [b.code, b]));
  for (const board of list) if (!merged.has(board.code)) merged.set(board.code, board);
  const snapshot = { ...latest, boards: [...merged.values()].filter((b) => !isExcludedBoard(b.name)) };
  const engine = options.engine || await import('../short-emotion/engine.js');
  return refreshHistory(store, engine, snapshot, options);
}
