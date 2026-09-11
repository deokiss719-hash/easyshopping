(() => {
  'use strict';

  const state = {
    csrfToken: '',
    deals: [],
    fetchedMetadataUrl: '',
    formGeneration: 0,
    uploadGeneration: 0,
    uploadController: null,
    uploadPromise: null,
    savingDeal: false,
  };
  const byId = (id) => document.getElementById(id);
  const normalizeHttpsUrlInput = window.AdminUrlUtils.normalizeHttpsUrlInput;

  function showMessage(id, message, kind = 'notice') {
    const element = byId(id);
    if (!element) return;
    element.textContent = message;
    element.className = `message ${kind}`;
  }

  function errorMessage(error, fallback) {
    if (error && error.message && !/^HTTP \d+$/.test(error.message)) return error.message;
    return fallback;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const method = String(options.method || 'GET').toUpperCase();
    if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD'].includes(method) && state.csrfToken) headers.set('X-CSRF-Token', state.csrfToken);
    const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' });
    if (response.status === 401) {
      window.location.replace('/admin/login');
      throw new Error('로그인이 만료되었습니다.');
    }
    if (!response.ok) {
      let detail = null;
      try { detail = await response.json(); } catch { /* An empty error response is valid. */ }
      throw new Error(detail?.message || detail?.error || `HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function setView(viewId) {
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === viewId));
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === viewId));
    byId('sidebar')?.classList.remove('open');
    byId('scrim')?.classList.remove('open');
    byId('menu-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function textNode(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function priceText(value) {
    return Number.isSafeInteger(value) ? `${value.toLocaleString('ko-KR')}원` : '가격 미정';
  }

  function dealSummary(deal, compact = false) {
    const article = document.createElement('article');
    article.className = compact ? 'compact-item' : 'deal-item';
    const body = document.createElement('div');
    if (!compact) {
      body.className = 'deal-content';
      let thumbnail;
      if (isTrustedImageUrl(deal.imageUrl)) {
        thumbnail = document.createElement('img');
        thumbnail.className = 'deal-thumb';
        thumbnail.src = deal.imageUrl;
        thumbnail.alt = '';
        thumbnail.addEventListener('error', () => {
          thumbnail.replaceWith(textNode('div', '이미지 없음', 'deal-thumb deal-thumb-placeholder'));
        }, { once: true });
      } else {
        thumbnail = textNode('div', '이미지 없음', 'deal-thumb deal-thumb-placeholder');
      }
      article.append(thumbnail);
    }
    body.append(textNode('strong', deal.title || '제목 없음'));
    body.append(textNode('p', `${deal.merchant || '판매처 미정'} · ${priceText(deal.priceAmount)}`));
    const flags = [];
    flags.push(deal.isPublished ? '게시 중' : '초안');
    if (deal.showOnHome) flags.push('메인 노출');
    flags.push(`우선순위 ${Number.isSafeInteger(deal.priority) ? deal.priority : 0}`);
    body.append(textNode('span', flags.join(' · '), 'deal-meta'));
    if (!compact) {
      const actions = document.createElement('div');
      actions.className = 'deal-actions';
      const edit = textNode('button', '편집', 'button secondary');
      edit.type = 'button';
      edit.addEventListener('click', () => editDeal(deal.id));
      const remove = textNode('button', '삭제', 'text-button danger');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteDeal(deal.id));
      actions.append(edit, remove);
      body.append(actions);
    }
    article.append(body);
    return article;
  }

  function renderDeals() {
    byId('stat-total').textContent = String(state.deals.length);
    byId('stat-published').textContent = String(state.deals.filter((deal) => deal.isPublished).length);
    byId('stat-home').textContent = String(state.deals.filter((deal) => deal.isPublished && deal.showOnHome).length);
    byId('deal-count').textContent = String(state.deals.length);

    const recent = byId('recent-deals');
    const list = byId('deal-list');
    recent.replaceChildren();
    list.replaceChildren();
    if (!state.deals.length) {
      recent.append(textNode('p', '등록된 핫딜이 없습니다.', 'empty-state'));
      list.append(textNode('p', '새 핫딜을 등록해 주세요.', 'empty-state'));
      return;
    }
    state.deals.slice(0, 5).forEach((deal) => recent.append(dealSummary(deal, true)));
    state.deals.forEach((deal) => list.append(dealSummary(deal)));
  }

  async function loadDeals() {
    const data = await api('/api/admin/manual-deals');
    state.deals = Array.isArray(data?.deals) ? data.deals : [];
    renderDeals();
  }

  const trafficSourceLabels = Object.freeze({
    direct: '직접 방문',
    internal: '사이트 내부',
    search: '검색',
    social: 'SNS',
    referral: '외부 사이트',
  });

  function renderTrafficRows(list, rows, emptyCopy, showDetails = false) {
    list.replaceChildren();
    if (!rows.length) {
      list.append(textNode('p', emptyCopy, 'empty-copy'));
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'referrer-item';
      const copy = document.createElement('div');
      copy.append(textNode('strong', trafficSourceLabels[row.source] || '기타'));
      copy.append(textNode('span', row.domain || '주소 직접 입력·즐겨찾기'));
      if (showDetails && row.searchTerm) copy.append(textNode('span', `검색어: ${row.searchTerm}`, 'referrer-detail'));
      if (showDetails && row.referrerUrl) {
        try {
          const url = new URL(row.referrerUrl);
          if (['https:', 'http:'].includes(url.protocol)) {
            const link = textNode('a', row.referrerUrl, 'referrer-link');
            link.href = row.referrerUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            copy.append(link);
          }
        } catch { /* Invalid analytics URLs are not rendered as links. */ }
      }
      item.append(copy, textNode('b', `${Number(row.visitors || 0).toLocaleString('ko-KR')}명`));
      list.append(item);
    });
  }

  function renderTraffic(data) {
    byId('stat-visitors-today').textContent = Number(data.uniqueVisitors || 0).toLocaleString('ko-KR');
    byId('stat-pageviews-today').textContent = Number(data.pageViews || 0).toLocaleString('ko-KR');
    byId('analytics-day').textContent = `${String(data.day || '')} · 한국시간 기준`;
    renderTrafficRows(
      byId('referrer-breakdown'),
      Array.isArray(data.referrers) ? data.referrers : [],
      '아직 오늘 유입 기록이 없습니다.',
    );
    renderTrafficRows(
      byId('referrer-details'),
      Array.isArray(data.referrerDetails) ? data.referrerDetails : [],
      '아직 검색어나 유입 URL 기록이 없습니다.',
      true,
    );
  }

  async function loadTraffic() {
    const button = byId('refresh-traffic');
    if (button) button.disabled = true;
    showMessage('analytics-message', '');
    try {
      renderTraffic(await api('/api/admin/analytics/today'));
    } catch (error) {
      showMessage('analytics-message', errorMessage(error, '트래픽을 불러오지 못했습니다.'), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setValue(id, value) {
    const element = byId(id);
    if (element) element.value = value == null ? '' : String(value);
  }

  function updateSaveControl() {
    const button = byId('save-deal');
    if (button) button.disabled = state.savingDeal || state.uploadPromise !== null;
  }

  function clearImagePreview() {
    const preview = byId('image-preview');
    if (!preview) return;
    preview.removeAttribute('src');
    preview.hidden = true;
  }

  function isTrustedImageUrl(value) {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  function showExistingImagePreview(value) {
    clearImagePreview();
    if (!isTrustedImageUrl(value)) return;
    const preview = byId('image-preview');
    preview.src = value;
    preview.hidden = false;
  }

  function invalidateUpload() {
    state.formGeneration += 1;
    state.uploadGeneration += 1;
    state.uploadController?.abort();
    state.uploadController = null;
    state.uploadPromise = null;
    updateSaveControl();
  }

  function resetForm() {
    invalidateUpload();
    byId('deal-form').reset();
    setValue('deal-id', '');
    setValue('priority', 0);
    setValue('category', '디지털/가전');
    byId('form-title').textContent = '새 핫딜 등록';
    byId('cancel-edit').classList.add('hidden');
    state.fetchedMetadataUrl = '';
    clearImagePreview();
    byId('image-upload-status').textContent = '이미지를 선택하면 안전한 WebP 파일로 업로드합니다. (최대 10 MiB)';
    byId('metadata-message').textContent = 'HTTPS 상품 URL을 입력하면 제목, 가격, 이미지 등을 자동으로 채워요.';
  }

  function editDeal(id) {
    const deal = state.deals.find((item) => String(item.id) === String(id));
    if (!deal) return;
    invalidateUpload();
    setView('phone-deals');
    setValue('deal-id', deal.id);
    setValue('metadata-url', deal.productUrl);
    setValue('target-url', deal.productUrl);
    setValue('title', deal.title);
    setValue('current-price', deal.priceAmount);
    setValue('original-price', deal.originalPriceAmount);
    setValue('image-url', deal.imageUrl);
    showExistingImagePreview(deal.imageUrl);
    setValue('merchant', deal.merchant);
    setValue('category', deal.category || '디지털/가전');
    setValue('description', deal.description);
    setValue('priority', Number.isSafeInteger(deal.priority) ? deal.priority : 0);
    byId('is-published').checked = deal.isPublished === true;
    byId('show-on-home').checked = deal.showOnHome === true;
    byId('form-title').textContent = '핫딜 편집';
    byId('cancel-edit').classList.remove('hidden');
    state.fetchedMetadataUrl = deal.productUrl || '';
    byId('deal-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function parsePrice(id) {
    const raw = byId(id).value.trim();
    if (!raw) return null;
    const value = Number(raw.replaceAll(',', ''));
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('가격은 0 이상의 정수로 입력해 주세요.');
    return value;
  }

  function formPayload() {
    const priority = Number(byId('priority').value);
    if (!Number.isSafeInteger(priority)) throw new TypeError('우선순위는 정수로 입력해 주세요.');
    const productUrl = normalizeHttpsUrlInput(byId('target-url').value);
    setValue('target-url', productUrl);
    return {
      title: byId('title').value.trim(),
      productUrl,
      imageUrl: byId('image-url').value.trim() || null,
      merchant: byId('merchant').value.trim() || null,
      priceAmount: parsePrice('current-price'),
      originalPriceAmount: parsePrice('original-price'),
      description: byId('description').value.trim() || null,
      category: byId('category').value,
      isPublished: byId('is-published').checked,
      showOnHome: byId('show-on-home').checked,
      priority,
    };
  }

  async function fetchMetadata({ quiet = false } = {}) {
    const url = normalizeHttpsUrlInput(byId('metadata-url').value);
    setValue('metadata-url', url);
    if (!url) {
      if (!quiet) byId('metadata-message').textContent = '상품 URL을 입력해 주세요.';
      return false;
    }
    const button = byId('metadata-fetch');
    button.disabled = true;
    byId('metadata-message').textContent = '상품 정보를 가져오는 중입니다…';
    try {
      const data = await api('/api/admin/url-metadata', { method: 'POST', body: JSON.stringify({ url }) });
      if (data.title) setValue('title', data.title);
      if (data.priceAmount != null) setValue('current-price', data.priceAmount);
      if (data.imageUrl) setValue('image-url', data.imageUrl);
      if (data.merchant) setValue('merchant', data.merchant);
      setValue('target-url', data.productUrl || url);
      state.fetchedMetadataUrl = url;
      byId('metadata-message').textContent = '상품 정보를 가져왔습니다. 내용을 확인해 주세요.';
      return true;
    } catch (error) {
      state.fetchedMetadataUrl = '';
      byId('metadata-message').textContent = errorMessage(error, '상품 정보를 가져오지 못했습니다.');
      return false;
    } finally {
      button.disabled = false;
    }
  }

  async function uploadImage() {
    const input = byId('image-file');
    const file = input.files?.[0];
    if (!file) return;

    state.uploadController?.abort();
    const formGeneration = state.formGeneration;
    const uploadGeneration = ++state.uploadGeneration;
    const controller = new AbortController();
    state.uploadController = controller;

    const preview = byId('image-preview');
    clearImagePreview();
    setValue('image-url', '');
    byId('image-upload-status').textContent = '이미지를 업로드하는 중입니다…';

    let uploadPromise;
    try {
      uploadPromise = api('/api/admin/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
        signal: controller.signal,
      });
      state.uploadPromise = uploadPromise;
      updateSaveControl();
      const data = await uploadPromise;
      if (state.formGeneration !== formGeneration || state.uploadGeneration !== uploadGeneration || controller.signal.aborted) return;
      if (!isTrustedImageUrl(data?.imageUrl)) throw new Error('서버가 안전한 이미지 URL을 반환하지 않았습니다.');
      setValue('image-url', data.imageUrl);
      preview.src = data.imageUrl;
      preview.hidden = false;
      byId('image-upload-status').textContent = '이미지를 업로드했습니다.';
    } catch (error) {
      if (state.formGeneration === formGeneration && state.uploadGeneration === uploadGeneration && !controller.signal.aborted) {
        byId('image-upload-status').textContent = errorMessage(error, '이미지를 업로드하지 못했습니다.');
      }
    } finally {
      if (state.formGeneration === formGeneration && state.uploadGeneration === uploadGeneration && state.uploadPromise === uploadPromise) {
        state.uploadController = null;
        state.uploadPromise = null;
        updateSaveControl();
      }
    }
  }

  async function saveDeal(event) {
    event.preventDefault();
    const formGeneration = state.formGeneration;
    const uploadGeneration = state.uploadGeneration;
    state.savingDeal = true;
    updateSaveControl();
    try {
      if (state.uploadPromise) await state.uploadPromise;
      if (state.formGeneration !== formGeneration || state.uploadGeneration !== uploadGeneration) return;
      const id = byId('deal-id').value;
      const payload = formPayload();
      await api(id ? `/api/admin/manual-deals/${encodeURIComponent(id)}` : '/api/admin/manual-deals', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      resetForm();
      await loadDeals();
      showMessage('status-message', id ? '핫딜을 수정했습니다.' : '새 핫딜을 등록했습니다.', 'success');
    } catch (error) {
      showMessage('status-message', errorMessage(error, '핫딜을 저장하지 못했습니다.'), 'error');
    } finally {
      state.savingDeal = false;
      updateSaveControl();
    }
  }

  async function deleteDeal(id) {
    const deal = state.deals.find((item) => String(item.id) === String(id));
    if (!deal || !window.confirm(`“${deal.title}” 핫딜을 삭제할까요?`)) return;
    invalidateUpload();
    try {
      await api(`/api/admin/manual-deals/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (byId('deal-id').value === String(id)) resetForm();
      await loadDeals();
      showMessage('status-message', '핫딜을 삭제했습니다.', 'success');
    } catch (error) {
      showMessage('status-message', errorMessage(error, '핫딜을 삭제하지 못했습니다.'), 'error');
    }
  }

  async function loadSettings() {
    const settings = await api('/api/admin/settings');
    setValue('setting-home-limit', settings.home_manual_limit ?? 4);
    setValue('setting-searches', Array.isArray(settings.recommended_searches) ? settings.recommended_searches.join(', ') : '');
    setValue('setting-main-copy', settings.main_copy);
    setValue('setting-phone-title', settings.phone_section_title);
    setValue('setting-admin-note', settings.admin_note);
  }

  async function saveSettings(event) {
    event.preventDefault();
    const values = {
      home_manual_limit: Number(byId('setting-home-limit').value),
      recommended_searches: byId('setting-searches').value.split(',').map((value) => value.trim()).filter(Boolean),
      main_copy: byId('setting-main-copy').value.trim(),
      phone_section_title: byId('setting-phone-title').value.trim(),
      admin_note: byId('setting-admin-note').value.trim(),
    };
    const button = byId('save-settings');
    button.disabled = true;
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values }) });
      showMessage('settings-message', '사이트 설정을 저장했습니다.', 'success');
    } catch (error) {
      showMessage('settings-message', errorMessage(error, '설정을 저장하지 못했습니다.'), 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try { await api('/api/admin/auth/logout', { method: 'POST' }); } finally { window.location.replace('/admin/login'); }
  }

  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
    document.querySelectorAll('[data-open-deals]').forEach((button) => button.addEventListener('click', () => setView('phone-deals')));
    byId('new-deal').addEventListener('click', () => { resetForm(); setView('phone-deals'); byId('title').focus(); });
    byId('cancel-edit').addEventListener('click', resetForm);
    byId('deal-form').addEventListener('submit', saveDeal);
    byId('metadata-fetch').addEventListener('click', () => fetchMetadata());
    byId('image-file').addEventListener('change', uploadImage);
    byId('metadata-url').addEventListener('input', () => { state.fetchedMetadataUrl = ''; });
    byId('metadata-url').addEventListener('change', () => { if (byId('metadata-url').checkValidity()) fetchMetadata({ quiet: true }); });
    byId('settings-form')?.addEventListener('submit', saveSettings);
    byId('refresh-traffic')?.addEventListener('click', loadTraffic);
    byId('logout').addEventListener('click', logout);
    byId('menu-toggle').addEventListener('click', () => {
      const open = !byId('sidebar').classList.contains('open');
      byId('sidebar').classList.toggle('open', open);
      byId('scrim').classList.toggle('open', open);
      byId('menu-toggle').setAttribute('aria-expanded', String(open));
    });
    byId('scrim').addEventListener('click', () => {
      byId('sidebar').classList.remove('open');
      byId('scrim').classList.remove('open');
      byId('menu-toggle').setAttribute('aria-expanded', 'false');
    });
  }

  async function start() {
    bindEvents();
    try {
      const session = await api('/api/admin/auth/session');
      state.csrfToken = session.csrfToken;
      byId('admin-user').textContent = session.username || '';
      await Promise.all([loadDeals(), loadSettings(), loadTraffic()]);
    } catch (error) {
      showMessage('status-message', errorMessage(error, '관리자 데이터를 불러오지 못했습니다.'), 'error');
    }
  }

  start();
})();
