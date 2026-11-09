import { HORIZONS, LOGIC_TAGS, escapeHtml } from '../kandian/data.js?v=5';

// The stock comes only from the displayed report; the server fetches a fresh quote on publish.
export function initViewDrawer({ root = document, request = fetch, goLogin, onPublished = () => {} } = {}) {
  const bar = root.querySelector('#ta-view-bar');
  const dialog = root.querySelector('#ta-view-drawer');
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('[role="alert"]');
  const submit = form.querySelector('[type="submit"]');
  const status = root.querySelector('#ta-view-status');
  let stock = null, direction = null, horizon = null, pending = false;
  let requestId = crypto.randomUUID();
  let retryBody = null;
  let scrollTimer;
  const page = root.defaultView;
  page.addEventListener('scroll', () => {
    if (!stock || dialog.open) return;
    bar.classList.add('is-scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => bar.classList.remove('is-scrolling'), 650);
  }, { passive: true });
  const tags = new Set();

  const logic = dialog.querySelector('#ta-view-logic');
  const tagOptions = dialog.querySelector('#ta-view-tags');

  function setDirection(value) {
    if (direction === value) return;
    direction = value;
    tags.clear();
    logic.hidden = !direction;
    tagOptions.innerHTML = (LOGIC_TAGS[direction] || []).map(tag => `<button type="button" data-tag="${escapeHtml(tag)}" aria-pressed="false">${escapeHtml(tag)}</button>`).join('');
  }
  function renderChoices() {
    for (const button of form.querySelectorAll('[data-direction]')) button.setAttribute('aria-pressed', String(button.dataset.direction === direction));
    for (const button of form.querySelectorAll('[data-horizon]')) button.setAttribute('aria-pressed', String(Number(button.dataset.horizon) === horizon));
    for (const button of form.querySelectorAll('[data-tag]')) button.setAttribute('aria-pressed', String(tags.has(button.dataset.tag)));
  }
  function reset() {
    setDirection(null);
    horizon = null;
    requestId = crypto.randomUUID();
    retryBody = null;
    error.textContent = '';
    renderChoices();
  }
  function close() { if (!pending) dialog.close(); }
  bar.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !stock || pending) return;
    if (button.dataset.direction) setDirection(button.dataset.direction);
    error.textContent = '';
    renderChoices();
    dialog.showModal();
  });
  dialog.querySelector('#ta-view-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => { root.documentElement.classList.remove('ta-view-modal-open'); });
  bar.addEventListener('click', () => { if (dialog.open) root.documentElement.classList.add('ta-view-modal-open'); });
  form.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || pending) return;
    if (button.dataset.direction) setDirection(button.dataset.direction);
    if (button.dataset.horizon) horizon = Number(button.dataset.horizon);
    if (button.dataset.tag) {
      const tag = button.dataset.tag;
      if (tags.has(tag)) tags.delete(tag);
      else if (tags.size < 3) tags.add(tag);
      else { error.textContent = '最多选择3项逻辑，可以先取消已选的一项。'; return; }
    }
    error.textContent = '';
    renderChoices();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    if (!stock || !Object.hasOwn(LOGIC_TAGS, direction) || !HORIZONS.includes(horizon) || !tags.size) {
      error.textContent = '请选择看法、期限和至少一项逻辑。';
      return;
    }
    const body = { action: 'publish', q: stock.code, direction, horizon, tags: [...tags] };
    // Retry an unchanged submission with its original key after an uncertain response.
    const fingerprint = JSON.stringify(body);
    if (retryBody !== null && retryBody !== fingerprint) requestId = crypto.randomUUID();
    retryBody = fingerprint;
    pending = true;
    error.textContent = '';
    for (const button of dialog.querySelectorAll('button')) button.disabled = true;
    submit.textContent = '正在发布…';
    try {
      const response = await request('/api/kandian', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, requestId })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) { goLogin?.(); throw new Error('请先登录后发布看法。'); }
      if (!response.ok || !payload.view?.id) throw new Error(payload.error || '发布失败，请稍后重试。');
      dialog.close();
      reset();
      status.hidden = false;
      onPublished(payload.view);
    } catch (failure) {
      error.textContent = failure.message || '发布失败，请稍后重试。';
    } finally {
      pending = false;
      for (const button of dialog.querySelectorAll('button')) button.disabled = false;
      submit.textContent = '发布看法';
    }
  });
  return {
    setStock(value) {
      if (stock?.code !== value?.code) {
        dialog.close();
        reset();
        status.hidden = true;
        clearTimeout(scrollTimer);
        bar.classList.remove('is-scrolling');
      }
      stock = value?.code && value?.name ? { code: value.code, name: value.name } : null;
      dialog.querySelector('#ta-view-stock').textContent = stock ? `${stock.name}（${stock.code}）` : '';
      bar.hidden = !stock;
      root.documentElement.classList.toggle('ta-has-view-bar', Boolean(stock));
    },
    setBusy(value) {
      bar.hidden = value || !stock;
      for (const button of bar.querySelectorAll('button')) button.disabled = value;
    }
  };
}
