'use strict';
const $ = (id) => document.getElementById(id);
let config,
  current,
  access = {},
  paymentReturn = null;
let stopReadingMotion = () => {};
const show = (id, yes) => ($(id).hidden = !yes);
const tell = (t) => {
  $('message').textContent = t;
};
const text = (tag, value, cls) => {
  const el = document.createElement(tag);
  el.textContent = value;
  if (cls) el.className = cls;
  return el;
};
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api/saju' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Saju-Request': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 204) return null;
  const x = await r.json();
  if (!r.ok) throw Error(x.error || '요청을 처리하지 못했어요.');
  return x;
}
async function busy(button, fn) {
  button.disabled = true;
  tell('');
  try {
    await fn();
  } catch (e) {
    tell(e.message);
    $('message').scrollIntoView({ block: 'center', behavior: 'smooth' });
  } finally {
    button.disabled = false;
  }
}
function block(b, report) {
  const wrap = document.createElement('article');
  // Chapter names remain; narrative subtitles no longer interrupt the story.
  // Only change presentation; the stored report wording stays unchanged.
  if (b.periods) {
    const labels = b.periods.map(value => value
      .replace(/^순행 약 /, '첫 번째 풀이: ')
      .replace(/^역행 약 /, '두 번째 풀이: ')
      .replace(/(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)세/, (_, start, end) => `약 ${Math.round(Number(start))}살부터 ${Math.round(Number(end))}살까지`)
      .replace(/년 입춘 이후/, '년 2월 초부터'));
    const periods = text('p', '', 'period-tags');
    labels.forEach(label => periods.append(text('span', label)));
    wrap.append(periods);
  }
  const savedParts = b.parts || b.text.split(/(?<=[.!?])\s+/u).map(text => ({text}));
  let paragraphs = savedParts.length === 5 && savedParts.every(p => p.label)
    ? [{text:savedParts.slice(0,3).map(p=>p.text).join(' ')},{text:savedParts.slice(3).map(p=>p.text).join(' ')}]
    : savedParts;
  if (b.id === 'flow-guide') {
    paragraphs = [
      { text: '이제 나이와 해에 따라 어떤 이야기가 담겨 있는지 들려주마. 적힌 때에 꼭 그 일이 생긴다는 뜻은 아니란다. 니가 어디에서 누구와 지내고 무엇을 고르는지에 따라 삶은 달라진다.' },
      { text: '나이별 이야기는 두 가지로 나올 수 있단다. 지금 받은 정보만으로는 둘 중 어느 쪽이 니에게 맞는지 정할 수 없어 함께 적었지. 둘 다 겪는다는 뜻도, 마음에 드는 쪽을 고르라는 뜻도 아니란다.' },
      { text: '첫 번째 풀이와 두 번째 풀이에 적힌 나이는 대략의 나이란다. 연도가 적힌 이야기는 그해 2월 초부터 다음 해 2월 초까지를 보고 풀었지. 같은 이야기가 나오는 나이와 해는 한곳에 모아두었단다.' },
    ];
  }
  for (const [groupIndex, part] of paragraphs.entries()) {
    // Sentence-by-sentence reading changes presentation, not saved report text.
    const sentences = part.text.trim().split(/(?<=[.!?。！？])\s+/u);
    sentences.forEach((sentence, index) => {
      const paragraph = text('p', sentence);
      if (index === 0 && groupIndex > 0) paragraph.className = 'story-paragraph-start';
      wrap.append(paragraph);
    });
  }
  return wrap;
}
function accessUi() {
  $('private-link').value = access.link || '';
  $('recovery-code').value = access.recovery || '';
  show('recovery-code-label', !!access.recovery);
  $('save-access').disabled = !access.link;
}
const elementClass = { 목: 'wood', 화: 'fire', 토: 'earth', 금: 'metal', 수: 'water' };
function renderChart(chart) {
  const table = document.createElement('table');
  table.className = 'birth-chart';
  const caption = text('caption', '확정된 사주 네 기둥');
  const head = document.createElement('thead');
  const tr = document.createElement('tr');
  tr.append(text('th', ''));
  const columns = [['hour', '시주'], ['day', '일주'], ['month', '월주'], ['year', '연주']];
  for (const [, label] of columns) { const th = text('th', label); th.scope = 'col'; tr.append(th); }
  head.append(tr);
  const body = document.createElement('tbody');
  for (const [key, label] of [['stem', '천간'], ['branch', '지지'], ['tenGod', '십성'], ['hiddenStems', '지장간']]) {
    const row = document.createElement('tr');
    const th = text('th', label); th.scope = 'row'; row.append(th);
    for (const [column] of columns) {
      const p = chart.pillars[column], td = document.createElement('td');
      if (!p) td.append(text('span', '미확정', 'unconfirmed'));
      else if (key === 'stem' || key === 'branch') {
        const isStem = key === 'stem';
        const element = p[isStem ? 'elementStem' : 'elementBranch'];
        td.className = 'element-' + elementClass[element];
        td.append(text('strong', p.korean[isStem ? 0 : 1]), text('small', `${p[key]} · ${element}`));
      } else if (key === 'hiddenStems') {
        for (const v of p.hiddenStems) td.append(text('small', `${v.korean} ${v.tenGod}`));
      } else td.append(text('span', column === 'day' ? '일간' : p.tenGod));
      row.append(td);
    }
    body.append(row);
  }
  table.append(caption, head, body);
  $('pillars').replaceChildren(table);
  $('elements').replaceChildren(...Object.entries(chart.elements).map(([label, value]) => {
    const row = document.createElement('div'); row.className = 'element-bar element-' + elementClass[label];
    const meter = document.createElement('progress'); meter.max = 8; meter.value = value;
    meter.setAttribute('aria-label', `${label} ${value}개`);
    row.append(text('span', label), meter, text('span', `${value}개`));
    return row;
  }));
}
function renderContents(titles) {
  const descriptions = [
    '돈을 버는 방식과 비용·분배 때문에 돈이 새는 지점을 읽어요.',
    '잘 맞는 역할과 지치기 쉬운 환경을 구체적인 장면으로 읽어요.',
    '마음을 표현하는 방식과 반복되기 쉬운 갈등을 읽어요.',
    '나이별 두 가정과 해마다의 참고 주제를 읽어요. 확정된 예언이 아니에요.',
  ];
  $('toc').replaceChildren(...titles.map((title, i) => {
    const li = document.createElement('li');
    li.append(text('span', String(i + 1).padStart(2, '0'), 'chapter-number'),
      text('h3', title), text('p', descriptions[i] || ''), text('small', '전체 보고서에 수록', 'chapter-lock'));
    return li;
  }));
}
function renderStory() {
  stopReadingMotion();
  if (!current?.fullAccess && !current?.paid) return;
  // Move the shared chart out before replacing the previous report DOM.
  $('full-report').after($('chart-details'));
  show('chart-details', false);
  $('book-title').textContent = '태어난 날에 담긴 이야기';
  const sections = current.report.sections.filter(section => section.id !== 'basis');
  $('chapter-content').replaceChildren(...sections.map((section, index) => {
    const part = document.createElement('section');
    part.className = 'story-section';
    const heading = text('h3', section.title);
    heading.id = `story-section-${index}`;
    part.setAttribute('aria-labelledby', heading.id);
    part.append(heading, ...section.blocks.map(b => block(b, current.report)));
    return part;
  }));
  stopReadingMotion = window.startSajuReadingMotion($('chapter-content'), $('skip-reading-motion'));
}
function openCheckout() {
  if ((current?.accessMode || config.accessMode) === 'beta') {
    show('checkout-panel', true); show('purchase-controls', false);
    $('checkout-title').textContent = '다시 읽고 싶다면 · 선택 저장';
    $('checkout-summary').textContent = '지금은 저장하지 않고 전체 내용을 읽어도 됩니다. 무료 결과는 생성 후 7일 동안 보관합니다.';
    $('close-checkout').textContent = '← 보고서로 돌아가기';
    $('checkout-panel').scrollIntoView(); return;
  }
  show('checkout-panel', true);
  $('checkout-summary').textContent = current.paid
    ? '구매한 보고서를 다시 열 수 있도록 개인용 조회 수단을 보관해 주세요.'
    : `나의 사주 기본 보고서 · ${config.price.toLocaleString()}원 (부가세 포함) · 1년 열람${config.mode === 'live' ? '' : ' · 현재 실제 과금 없음'}`;
  $('close-checkout').textContent = current.paid ? '← 보고서로 돌아가기' : '← 무료 풀이로 돌아가기';
  $('checkout-title').focus({ preventScroll: true });
  $('checkout-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
$('continue-reading').onclick = openCheckout;
$('manage-access').onclick = openCheckout;
$('close-checkout').onclick = () => {
  show('checkout-panel', false);
  $(current.fullAccess || current.paid ? 'full-report' : 'paid-offer').scrollIntoView({ block: 'start' });
};
async function load(id) {
  current = await api('/reports/' + encodeURIComponent(id));
  sessionStorage.setItem('saju-current', id);
  const stored = sessionStorage.getItem('saju-access-' + id);
  if (stored) access = JSON.parse(stored);
  show('opening', false);
  show('input-panel', false);
  show('recovery-panel', false);
  show('result-panel', true);
  $('result-title').textContent = (current.name ? current.name + '님의 ' : '나의 ') + '사주 이야기';
  $('chart-meta').textContent = '양력 ' + current.chart.solarDate +
    (current.chart.pillars.hour ? ' · 시주 포함' : ' · 시주 미확정');
  $('reading-intro').textContent = ['ko-grandmother-2', 'ko-depth-3'].includes(current.report.version) ? '자, 네가 태어난 날에 담긴 이야기를 들려주마.' : '태어난 날의 글자에서, 나를 알아가는 이야기가 시작됩니다.';
  renderChart(current.chart);
  $('count-note').textContent =
    `확정된 ${current.chart.visibleCount}글자만 집계해요. 지장간 가중치·계절 강약은 제외한 분포예요.`;
  $('preview').replaceChildren(...current.report.preview.map((b) => { const section=document.createElement('section'); if(b.title)section.append(text('h3',b.title)); section.append(block(b,current.report));return section; }));
  $('free-limits').textContent = '전통 해석이며 실제 삶은 환경과 선택에 따라 달라져요. 나이별 흐름은 방향을 확정할 정보가 없어 두 가정으로 제공하며, 특정 사건을 예측하지 않아요. ' + (!current.chart.pillars.hour ? '태어난 시각을 몰라 달라질 수 있는 부분은 확정하지 않아요. ' : '') + (!current.chart.pillars.month ? '계산이 바뀌는 날짜라 일부 성향과 시기별 해석을 제한해요.' : '');
  $('warnings').replaceChildren(...current.chart.warnings.map((w) => text('li', w)));
  show('chart-details', false);
  if ((current?.accessMode || config.accessMode) === 'beta') {
    document.body.classList.add('beta-reading');
    show('paid-offer', false); show('free-reading', false); show('full-report', true);
    show('checkout-panel', false); show('purchase-controls', false); show('order-panel', false);
    $('book-version').textContent = current.report.version === config.version
      ? '전체 무료 베타 · 태어난 날을 전통 방식으로 풀어낸 이야기예요. 실제 삶은 환경과 선택에 따라 달라져요.'
      : '이전 버전으로 저장된 보고서입니다. 아래 새 분석 버튼으로 개편된 풀이를 볼 수 있습니다.';
    renderStory();
    $('expiry').textContent = '이 결과의 보관 기한: ' + new Date(current.expiresAt).toLocaleDateString('ko-KR');
    accessUi(); return;
  }
  renderContents(current.report.toc);
  $('sample').replaceChildren(block(current.report.sample, current.report));
  $('price').textContent = config.price.toLocaleString() + '원 (부가세 포함)';
  $('pay').textContent =
    config.mode === 'demo'
      ? '모의 결제 승인 · 실제 과금 없음'
      : config.mode === 'test'
        ? '테스트 결제하기 (실제 과금 없음)'
        : `${config.price.toLocaleString()}원 결제하기`;
  $('pay').disabled = !config.canPay;
  show('demo-fail', config.mode === 'demo');
  $('checkout-mode').textContent =
    config.mode === 'demo'
      ? '현재 체험 모드예요. PG 결제창 없이 모의 승인하며 실제 돈이 청구되지 않아요.'
      : config.mode === 'test'
        ? '토스페이먼츠 테스트 결제예요. 실제 과금·정산이 없어요.'
        : '카카오페이 또는 토스페이로 결제해요.';
  show('paid-offer', !current.paid);
  show('full-report', current.paid);
  show('free-reading', !current.paid);
  show('checkout-panel', false);
  show('purchase-controls', !current.paid);
  $('continue-reading').textContent = config.mode === 'demo'
    ? '이어서 보기 · 과금 없는 체험'
    : `이어서 보기 · ${config.price.toLocaleString()}원${config.mode === 'test' ? ' (테스트)' : ''}`;
  $('continue-reading').disabled = !config.canPay;
  if (current.paid) {
    $('book-version').textContent = `해석 버전 ${current.report.version} · 구매 시 저장된 내용`;
    renderStory();
  } else {
    $('chapter-content').replaceChildren();
  }
  show('order-panel', !!current.order);
  if (current.order) {
    const o = current.order;
    $('order-info').textContent =
      `주문 ${o.id} / ${o.amount.toLocaleString()}원 / ${o.mode === 'live' ? '실결제' : o.mode === 'test' ? 'PG 테스트' : '과금 없는 체험'} / ${o.status}`;
    show('recheck', ['pending', 'confirming', 'refunding'].includes(o.status));
    show('refund', ['paid', 'refund_requested'].includes(o.status));
    $('refund').disabled = o.status === 'refund_requested';
    $('refund-message').textContent =
      o.status === 'refund_requested'
        ? '환불 신청을 접수했어요. 운영자가 확인 후 처리해요.'
        : o.status === 'refunded'
          ? '환불이 완료되어 전체 보고서 열람이 종료되었어요.'
          : '';
  }
  $('expiry').textContent =
    '보고서 보관·열람 기한: ' + new Date(current.expiresAt).toLocaleDateString('ko-KR');
  accessUi();
}
async function checkout(fail = false) {
  if (!$('saved').checked || !$('terms').checked)
    throw Error('복구 수단 저장과 구매 안내 확인란을 체크해 주세요.');
  const order = await api('/reports/' + current.id + '/orders', {
    method: 'POST',
    body: { terms: true, recoverySaved: true },
  });
  sessionStorage.setItem('saju-order', order.id);
  if (order.amount !== config.price) {
    config.price = order.amount;
    $('price').textContent = order.amount.toLocaleString() + '원 (현재 주문 금액)';
    $('terms').checked = false;
    throw Error(
      '이전에 만든 주문의 금액을 표시했어요. 가격을 확인한 뒤 구매 안내에 다시 동의해 주세요.',
    );
  }
  if (['paid', 'refund_requested', 'refunded'].includes(order.status)) {
    await load(current.id);
    return;
  }
  if (order.status === 'confirming') {
    tell('이미 승인 확인 중인 주문이 있어요. 아래 승인 상태 확인을 이용해 주세요.');
    await load(current.id);
    return;
  }
  if (config.mode === 'demo') {
    if (fail) {
      await api('/orders/' + order.id + '/fail', { method: 'POST', body: {} });
      await load(current.id);
      tell(
        '체험 결제를 실패 처리했어요. 전체 보고서는 공개되지 않았고 실제 과금도 없어요. 다시 결제할 수 있어요.',
      );
      return;
    }
    await api('/orders/' + order.id + '/confirm', {
      method: 'POST',
      body: { amount: order.amount },
    });
    await load(current.id);
    tell('모의 결제가 완료됐어요. 카카오페이·토스페이에 실제 승인 요청을 보내지 않았어요.');
    $('full-report').scrollIntoView({block:'start'});
    return;
  }
  if (!window.TossPayments)
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v2/standard';
      s.onload = resolve;
      s.onerror = () => reject(Error('결제창을 불러오지 못했어요.'));
      document.head.append(s);
    });
  const payment = TossPayments(order.clientKey).payment({ customerKey: TossPayments.ANONYMOUS });
  try {
    await payment.requestPayment(window.SajuPaymentOptions.paymentRequest(order, document.querySelector('input[name="payment-method"]:checked').value));
  } catch (e) {
    throw Error('결제가 취소되었거나 결제창을 열지 못했어요. 같은 주문으로 다시 시도할 수 있어요.');
  }
}
$('begin-reading').onclick = () => {
  show('opening', false);
  show('input-panel', true);
  window.scrollTo({ top: 0 });
  form.elements.date.focus({ preventScroll: true });
};
$('back-opening').onclick = () => {
  show('input-panel', false);
  show('opening', true);
  tell('');
  window.scrollTo({ top: 0 });
};
const form = $('birth-form');
form.elements.date.addEventListener('input', (e) => {
  const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 8);
  e.target.value =
    v.length > 6
      ? v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6)
      : v.length > 4
        ? v.slice(0, 4) + '-' + v.slice(4)
        : v;
});
form.elements.calendar.onchange = () =>
  show('leap-label', form.elements.calendar.value === 'lunar');
form.elements.timeType.onchange = () => {
  show('exact-label', form.elements.timeType.value === 'exact');
  show('range-label', form.elements.timeType.value === 'range');
};
for (let i = 0; i < 12; i++) {
  const o = document.createElement('option');
  o.value = i;
  o.textContent = `${String(i * 2).padStart(2, '0')}:00 ~ ${String(i * 2 + 1).padStart(2, '0')}:59`;
  form.elements.period.append(o);
}
let started = false;
form.addEventListener('input', () => {
  if (!started) {
    started = true;
    api('/events', { method: 'POST', body: { event: 'input_start' } }).catch(() => {});
  }
});
form.onsubmit = (e) => {
  e.preventDefault();
  busy($('analyze'), async () => {
    show('input-panel', false);
    show('analysis-panel', true);
    $('analysis-status').textContent = '입력한 날짜와 시각을 바탕으로 원국과 풀이를 계산하고 있어요.';
    $('analysis-panel').scrollIntoView();
    try {
      const body = Object.fromEntries(new FormData(form));
      body.leap = body.leap === 'true';
      body.period = Number(body.period);
      body.consent = body.consent === 'on';
      const r = await api('/reports', { method: 'POST', body });
      access = { link: r.link, recovery: r.recovery };
      sessionStorage.setItem('saju-access-' + r.id, JSON.stringify(access));
      // Preserve the created report for retry if its subsequent read fails.
      sessionStorage.setItem('saju-current', r.id);
      $('analysis-status').textContent = '계산을 마쳤어요. 저장된 풀이를 불러오고 있어요.';
      await load(r.id);
      $('result-title').focus({ preventScroll: true });
      $('result-panel').scrollIntoView();
    } catch (e) {
      show('input-panel', true);
      throw e;
    } finally {
      show('analysis-panel', false);
    }
  });
};
$('recover-form').onsubmit = (e) => {
  e.preventDefault();
  busy(e.submitter, async () => {
    const r = await api('/recover', {
      method: 'POST',
      body: { code: e.target.elements.code.value.trim() },
    });
    access = { link: r.link };
    sessionStorage.setItem('saju-access-' + r.id, JSON.stringify(access));
    await load(r.id);
  });
};
$('new-analysis').onclick = () => {
  stopReadingMotion();
  sessionStorage.removeItem('saju-current');
  current = null;
  access = {};
  $('saved').checked = false;
  $('terms').checked = false;
  $('chart-details').open = false;
  show('result-panel', false);
  show('input-panel', true);
  form.reset();
  form.elements.calendar.onchange();
  form.elements.timeType.onchange();
  tell('');
  form.scrollIntoView();
};
$('pay').onclick = () => busy($('pay'), () => checkout());
$('demo-fail').onclick = () => busy($('demo-fail'), () => checkout(true));
$('save-access').onclick = () => {
  const contents = `이지핫딜 개인용 보고서\n조회 링크 (7일·1회): ${access.link}\n복구 코드: ${access.recovery || '최초 발급 시 저장한 코드를 사용해 주세요.'}\n보고서 ID: ${current.id}\n${$('expiry').textContent}\n다른 사람에게 공유하지 마세요.\n`;
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '이지핫딜-보고서-조회수단.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$('reissue').onclick = () =>
  busy($('reissue'), async () => {
    const r = await api('/reports/' + current.id + '/link', { method: 'POST', body: {} });
    access.link = r.link;
    sessionStorage.setItem('saju-access-' + current.id, JSON.stringify(access));
    accessUi();
    tell('이전 링크를 무효화하고 새 링크를 만들었어요. 새 링크를 저장해 주세요.');
  });
$('recheck').onclick = () =>
  busy($('recheck'), async () => {
    const r = paymentReturn
      ? await api('/orders/' + paymentReturn.orderId + '/confirm', {
          method: 'POST',
          body: { paymentKey: paymentReturn.paymentKey, amount: paymentReturn.amount },
        })
      : await api('/orders/' + current.order.id + '/recheck', { method: 'POST', body: {} });
    await load(current.id);
    tell(r.message || '주문 상태를 확인했어요.');
  });
$('refund').onclick = () =>
  busy($('refund'), async () => {
    await api('/orders/' + current.order.id + '/refund', { method: 'POST', body: {} });
    await load(current.id);
  });
$('delete').onclick = () => {
  if (!confirm('출생 정보와 보고서를 영구 삭제할까요? 복구 코드로도 되돌릴 수 없어요.')) return;
  busy($('delete'), async () => {
    await api('/reports/' + current.id, { method: 'DELETE' });
    sessionStorage.removeItem('saju-access-' + current.id);
    sessionStorage.removeItem('saju-current');
    show('result-panel', false);
    show('opening', true);
    tell('출생 정보와 보고서를 삭제했어요. 결제 기록은 법정 기간 동안 별도로 보관해요.');
  });
};
async function init() {
  const query = new URLSearchParams(location.search),
    fragment = location.hash.slice(1),
    route = location.pathname;
  history.replaceState(null, '', route);
  config = await api('/config');
  $('opening-note').textContent = config.accessMode === 'beta' ? '전체 무료 베타 · 회원가입 없이' : `성격·장단점 무료 · 상세 보고서 ${config.price.toLocaleString()}원${config.mode !== 'live' ? ' (테스트 · 실제 과금 없음)' : ''} · 회원가입 없이`;
  if ((current?.accessMode || config.accessMode) === 'beta') document.body.classList.add('beta-reading');
  $('seller-info').textContent = config.seller?.name
    ? `판매자: ${config.seller.name} / 대표: ${config.seller.representative} / 사업자등록번호: ${config.seller.registration} / 통신판매: ${config.seller.commerce} / 주소: ${config.seller.address} / 연락처: ${config.seller.contact}`
    : '실판매 전 판매자 사업자 정보를 등록할 예정이에요. 현재 실제 과금은 하지 않아요.';
  $('zones').replaceChildren(
    ...Object.entries(config.zones).map(([value, label]) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      return o;
    }),
  );
  if ((current?.accessMode || config.accessMode) === 'beta') {
    show('mode', true); $('mode').textContent = '전체 무료 베타 · 모든 장을 바로 읽을 수 있습니다.';
  } else if (config.mode !== 'live') {
    show('mode', true);
    $('mode').textContent =
      config.mode === 'demo'
        ? '체험 운영 중 · 실제 결제가 아닙니다. 카드 정보 없이 모의 구매 흐름을 확인할 수 있어요.'
        : '테스트 결제 운영 중 · 실제 과금은 없습니다.';
  }
  api('/events', { method: 'POST', body: { event: 'visit' } }).catch(() => {});
  if (route === '/saju/recover') {
    show('opening', false);
    show('input-panel', false);
    show('recovery-panel', true);
    if (fragment) {
      const r = await api('/recover', { method: 'POST', body: { code: fragment, isLink: true } });
      access = { link: r.link };
      sessionStorage.setItem('saju-access-' + r.id, JSON.stringify(access));
      await load(r.id);
    }
    return;
  }
  if (route === '/saju/success') {
    paymentReturn = query.get('orderId')
      ? {
          orderId: query.get('orderId'),
          paymentKey: query.get('paymentKey'),
          amount: Number(query.get('amount')),
        }
      : JSON.parse(sessionStorage.getItem('saju-payment-return') || 'null');
    if (paymentReturn) sessionStorage.setItem('saju-payment-return', JSON.stringify(paymentReturn));
    if (!paymentReturn?.orderId)
      throw Error('결제 승인 정보를 찾지 못했어요. 구매 보고서 찾기를 이용해 주세요.');
    const r = await api('/orders/' + encodeURIComponent(paymentReturn.orderId) + '/confirm', {
      method: 'POST',
      body: paymentReturn,
    });
    const id = r.reportId || sessionStorage.getItem('saju-current');
    if (id) await load(id);
    tell(r.message || '결제가 확인되어 보고서가 열렸어요.');
    if (current?.paid) $('full-report').scrollIntoView({block:'start'});
    return;
  }
  if (route === '/saju/fail') {
    const id = query.get('orderId') || sessionStorage.getItem('saju-order');
    if (id) {
      const r = await api('/orders/' + encodeURIComponent(id) + '/fail', {
        method: 'POST',
        body: {},
      });
      await load(r.reportId);
    }
    tell('결제가 취소되었거나 실패했어요. 유료 보고서는 공개되지 않았어요. 다시 시도할 수 있어요.');
    return;
  }
  const last = sessionStorage.getItem('saju-current');
  if (last) {
    try {
      await load(last);
    } catch {
      sessionStorage.removeItem('saju-current');
    }
  }
}
init().catch((e) => tell(e.message));
