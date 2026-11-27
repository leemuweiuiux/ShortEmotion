// The daily task starts at 20:05 Beijing time on weekdays; holidays produce no forecast.
const OFFSET = 8 * 60 * 60_000;
const DAY = 24 * 60 * 60_000;
const START = (20 * 60 + 5) * 60_000;
const END = (23 * 60 + 50) * 60_000;

export function forecastTiming(now = Date.now()) {
  const local = new Date(Number(now) + OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const weekday = local.getUTCDay();
  const elapsed = local.getTime() - midnight;
  if (weekday > 0 && weekday < 6 && elapsed >= START && elapsed <= END) {
    return { waiting: true, seconds: 0, label: "等待本轮结果" };
  }
  let target = midnight + START;
  if (target <= local.getTime()) target += DAY;
  while ([0, 6].includes(new Date(target).getUTCDay())) target += DAY;
  const days = Math.round((target - START - midnight) / DAY);
  const day = days === 0 ? "今天" : days === 1 ? "明天" : "周" + "日一二三四五六"[new Date(target).getUTCDay()];
  return { waiting: false, seconds: Math.ceil((target - local.getTime()) / 1000), label: `${day} 20:05 开始更新` };
}

export function mountForecastEmpty(root, { hasStocks, historical = false }, { now = Date.now } = {}) {
  if (!hasStocks || historical) {
    root.innerHTML = historical
      ? '<div class="watch-empty"><strong>当日暂无预测</strong><p>试试其他日期，后续记录会陆续更新。</p></div>'
      : '<div class="watch-empty"><strong>先添加关注</strong><p>添加公司后，晚间生成每日预测。</p><button type="button" class="watch-empty-action" data-add-stock>添加关注</button></div>';
    return () => {};
  }
  const digit = '<span class="watch-digit"><span class="watch-digit-value">0</span><span class="watch-digit-top" aria-hidden="true">0</span><span class="watch-digit-bottom" aria-hidden="true">0</span></span>';
  const units = ["时", "分", "秒"].map(unit => `<span class="watch-clock-unit"><span class="watch-clock-pair">${digit.repeat(2)}</span><small>${unit}</small></span>`);
  root.innerHTML = `<div class="watch-empty watch-forecast-empty">
    <strong data-clock-title></strong>
    <div class="watch-clock" role="timer" aria-live="off" aria-label="距定时更新">${units.join('<span class="watch-clock-colon" aria-hidden="true">:</span>')}</div>
    <p data-clock-note></p>
    <small>工作日 20:05 · 北京时间 · 休市日不生成预测</small>
  </div>`;
  const title = root.querySelector('[data-clock-title]');
  const note = root.querySelector('[data-clock-note]');
  const clock = root.querySelector('.watch-clock');
  const digits = [...root.querySelectorAll('.watch-digit')];
  let previous = "";
  const tick = () => {
    const timing = forecastTiming(now());
    if (title.textContent !== timing.label) title.textContent = timing.label;
    const description = timing.waiting ? "更新结果就绪后，这里会自动显示。" : "你的关注已保存，更新后自动显示预测。";
    if (note.textContent !== description) note.textContent = description;
    clock.hidden = timing.waiting;
    const hours = Math.floor(timing.seconds / 3600);
    const minutes = Math.floor(timing.seconds / 60) % 60;
    const seconds = timing.seconds % 60;
    const values = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join('');
    clock.setAttribute('aria-label', `距定时更新 ${hours} 小时 ${minutes} 分 ${seconds} 秒`);
    digits.forEach((digit, index) => {
      if (previous[index] === values[index]) return;
      digit.querySelector('.watch-digit-top').textContent = previous[index] ?? values[index];
      digit.querySelector('.watch-digit-value').textContent = values[index];
      digit.querySelector('.watch-digit-bottom').textContent = values[index];
      digit.classList.toggle('is-flipping', Boolean(previous));
    });
    previous = values;
  };
  const endFlip = event => {
    if (event.animationName === 'watch-flip-bottom') event.target.parentElement.classList.remove('is-flipping');
  };
  root.addEventListener('animationend', endFlip);
  tick();
  let timer = setInterval(tick, 1000);
  const visibility = () => {
    clearInterval(timer);
    if (!document.hidden) { tick(); timer = setInterval(tick, 1000); }
  };
  document.addEventListener('visibilitychange', visibility);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visibility);
    root.removeEventListener('animationend', endFlip);
  };
}
