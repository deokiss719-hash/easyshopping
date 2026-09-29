'use strict';
const $ = (id) => document.getElementById(id);
let config,
  current,
  access = {},
  paymentReturn = null;
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
  wrap.append(text('h3', b.title), text('p', b.text));
  const detail = document.createElement('details');
  detail.className = 'evidence';
  detail.append(text('summary', '이 해석의 계산 근거'));
  for (const e of report.evidence?.[b.id] || [])
    detail.append(text('p', e.path), text('pre', JSON.stringify(e.value, null, 2)));
  wrap.append(detail);
  return wrap;
}
function accessUi() {
  $('private-link').value = access.link || '';
  $('recovery-code').value = access.recovery || '';
  show('recovery-code-label', !!access.recovery);
  $('save-access').disabled = !access.link;
}
async function load(id) {
  current = await api('/reports/' + encodeURIComponent(id));
  sessionStorage.setItem('saju-current', id);
  const stored = sessionStorage.getItem('saju-access-' + id);
  if (stored) access = JSON.parse(stored);
  show('input-panel', false);
  show('recovery-panel', false);
  show('result-panel', true);
  $('result-title').textContent = (current.name ? current.name + '님의 ' : '나의 ') + '사주 원국';
  $('chart-meta').textContent = '양력 ' + current.chart.solarDate;
  $('pillars').replaceChildren();
  for (const [k, title] of Object.entries({
    year: '연주',
    month: '월주',
    day: '일주',
    hour: '시주',
  })) {
    const p = current.chart.pillars[k],
      el = document.createElement('div');
    el.className = 'pillar';
    el.append(
      text('small', title),
      text('strong', p ? p.korean : '미확정'),
      text('small', p ? p.chars : '—'),
      text('small', p ? `${p.elementStem} · ${p.elementBranch}` : ''),
    );
    $('pillars').append(el);
  }
  $('elements').replaceChildren(
    ...Object.entries(current.chart.elements).map(([k, v]) => text('span', `${k} ${v}`, 'element')),
  );
  $('count-note').textContent =
    `확정된 ${current.chart.visibleCount}글자만 집계해요. 지장간 가중치·계절 강약은 제외한 분포예요.`;
  $('preview').replaceChildren(...current.report.preview.map((b) => block(b, current.report)));
  $('warnings').replaceChildren(...current.chart.warnings.map((w) => text('li', w)));
  $('toc').replaceChildren(...current.report.toc.map((t) => text('li', t)));
  $('sample').replaceChildren(block(current.report.sample, current.report));
  $('price').textContent = config.price.toLocaleString() + '원 (부가세 포함)';
  $('pay').textContent =
    config.mode === 'demo'
      ? '결제 없이 체험 보고서 열기'
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
        : '토스페이먼츠 결제창에서 카드 결제를 진행해요.';
  show('paid-offer', !current.paid);
  show('full-report', current.paid);
  if (current.paid) {
    $('full-report').replaceChildren(
      text('h2', '나의 사주 기본 보고서'),
      text('p', `해석 버전 ${current.report.version} · 구매 시 저장된 내용`),
    );
    for (const section of current.report.sections) {
      const el = document.createElement('section');
      el.className = 'report-section';
      el.append(text('h2', section.title), ...section.blocks.map((b) => block(b, current.report)));
      $('full-report').append(el);
    }
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
    tell('과금 없는 체험 승인이 완료되었어요.');
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
    await payment.requestPayment({
      method: 'CARD',
      amount: { currency: 'KRW', value: order.amount },
      orderId: order.id,
      orderName: '나의 사주 기본 보고서',
      successUrl: order.successUrl,
      failUrl: order.failUrl,
    });
  } catch (e) {
    throw Error('결제가 취소되었거나 결제창을 열지 못했어요. 같은 주문으로 다시 시도할 수 있어요.');
  }
}
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
    tell('입력한 날짜·지역과 가능한 시각의 원국을 계산하고 있어요.');
    const body = Object.fromEntries(new FormData(form));
    body.leap = body.leap === 'true';
    body.period = Number(body.period);
    body.consent = body.consent === 'on';
    const r = await api('/reports', { method: 'POST', body });
    access = { link: r.link, recovery: r.recovery };
    sessionStorage.setItem('saju-access-' + r.id, JSON.stringify(access));
    await load(r.id);
    tell('계산을 완료했어요. 먼저 무료 결과와 계산 한계를 확인해 주세요.');
    $('result-panel').scrollIntoView();
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
  sessionStorage.removeItem('saju-current');
  current = null;
  access = {};
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
    tell('출생 정보와 보고서를 삭제했어요. 결제 기록은 법정 기간 동안 별도로 보관해요.');
  });
};
async function init() {
  const query = new URLSearchParams(location.search),
    fragment = location.hash.slice(1),
    route = location.pathname;
  history.replaceState(null, '', route);
  config = await api('/config');
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
  if (config.mode !== 'live') {
    show('mode', true);
    $('mode').textContent =
      config.mode === 'demo'
        ? '체험 운영 중 · 실제 결제가 아닙니다. 카드 정보 없이 모의 구매 흐름을 확인할 수 있어요.'
        : '테스트 결제 운영 중 · 실제 과금은 없습니다.';
  }
  api('/events', { method: 'POST', body: { event: 'visit' } }).catch(() => {});
  if (route === '/saju/recover') {
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
