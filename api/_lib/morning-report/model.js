// 三期看点共用模型调用；Kimi K3 默认 max 推理不适合短篇定时报刊。
export function reportRequest(prompt, evidence, env = process.env) {
  const model = String(env.MORNING_REPORT_MODEL || '').trim();
  const body = { model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(evidence) }], response_format: { type: 'json_object' } };
  if (/^kimi-k3(?:$|-)/i.test(model)) Object.assign(body, { reasoning_effort: 'low', max_completion_tokens: 12000 });
  return body;
}
export async function generateReportJson(prompt, evidence, { env = process.env, fetcher = fetch } = {}) {
  if (!env.MORNING_REPORT_API_KEY || !env.MORNING_REPORT_BASE_URL || !env.MORNING_REPORT_MODEL) throw new Error('请配置 MORNING_REPORT_API_KEY / MODEL / BASE_URL');
  let response;
  try {
    response = await fetcher(`${env.MORNING_REPORT_BASE_URL.trim().replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.MORNING_REPORT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(reportRequest(prompt, evidence, env)), signal: AbortSignal.timeout(600000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('模型生成超过10分钟，未发布文章；检查模型调用记录后再重试，避免重复消耗');
    throw error;
  }
  if (!response.ok) throw new Error(`模型调用失败 HTTP ${response.status}`);
  const result = await response.json();
  const choice = result.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('模型输出达到上限，文章不完整，拒绝发布');
  if (!choice?.message?.content) throw new Error('模型没有返回文章正文，拒绝发布');
  try { return JSON.parse(choice.message.content); } catch { throw new Error('模型未返回合法JSON文章，拒绝发布'); }
}
