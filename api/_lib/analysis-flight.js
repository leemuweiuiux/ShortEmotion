// Coalesce duplicate submissions within one function instance. Never share a
// charged response across users; database-level coordination is a separate concern.
const flights = new Map();
export async function analysisFlight(key, task) {
  if (!key) return task();
  if (flights.has(key)) return flights.get(key);
  if (flights.size >= 200) return { status: 503, payload: { error: '分析繁忙，请稍后重试', code: 'analysis_busy' } };
  const pending = Promise.resolve().then(task);
  flights.set(key, pending);
  try { return await pending; }
  finally { if (flights.get(key) === pending) flights.delete(key); }
}
