'use strict';
const $ = (id) => document.getElementById(id);
let csrf = '';
const cell = (t) => {
  const e = document.createElement('td');
  e.textContent = t;
  return e;
};
async function api(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 401) {
    location.href = '/admin/login';
    throw Error('관리자 로그인이 필요해요.');
  }
  const x = await r.json();
  if (!r.ok) throw Error(x.error || '처리하지 못했어요.');
  return x;
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    $('message').textContent = e.message;
  }
}
async function load() {
  const x = await api('/api/admin/saju');
  $('mode').textContent =
    x.accessMode === 'beta' ? '전체 무료 베타입니다. 가격·무료 범위·판매 설정은 현재 고객 흐름에 적용되지 않습니다.' : x.mode === 'live' ? '실결제 환경이에요.' : '테스트/체험 환경이에요. 실제 과금은 없어요.';
  for (const [k, v] of Object.entries(x.settings)) {
    const e = $('settings').elements[k];
    if (e) {
      if (e.type === 'checkbox') e.checked = v;
      else e.value = v;
    }
  }
  $('orders').replaceChildren();
  const names = {
    pending: '결제 대기',
    confirming: '승인 확인 중',
    paid: '결제 완료',
    refund_requested: '환불 신청',
    refunding: '환불 확인 중',
    refunded: '환불 완료',
    failed: '결제 실패',
  };
  for (const o of x.orders) {
    const tr = document.createElement('tr');
    tr.append(
      cell(o.id + ' / ' + new Date(o.created_at).toLocaleString('ko-KR')),
      cell(o.amount.toLocaleString() + '원 / ' + o.mode),
      cell(names[o.status] || o.status),
    );
    const actions = cell('');
    if (['paid', 'refund_requested', 'refunding'].includes(o.status)) {
      const b = document.createElement('button');
      b.textContent = o.status === 'refunding' ? '환불 상태 재확인' : '전액 환불';
      b.className = 'secondary';
      b.onclick = () =>
        run(async () => {
          if (!confirm(`${o.amount.toLocaleString()}원 전액 환불을 처리할까요?`)) return;
          b.disabled = true;
          try {
            const r = await api('/api/admin/saju/orders/' + o.id + '/refund', 'POST', {});
            $('message').textContent =
              r.status === 'refunded'
                ? '환불이 완료되었어요.'
                : '환불 상태를 확인 중이에요. 같은 주문에서 다시 확인해 주세요.';
            await load();
          } finally {
            b.disabled = false;
          }
        });
      actions.append(b);
    }
    if (['confirming', 'paid', 'refund_requested'].includes(o.status)) {
      const b = document.createElement('button');
      b.textContent = '상태 확인';
      b.className = 'secondary';
      b.onclick = () =>
        run(async () => {
          await api('/api/admin/saju/orders/' + o.id + '/recheck', 'POST', {});
          await load();
        });
      actions.append(b);
    }
    tr.append(actions);
    $('orders').append(tr);
  }
  $('events').replaceChildren(
    ...x.events.map((e) => {
      const tr = document.createElement('tr');
      tr.append(
        cell(String(e.day).slice(0, 10)),
        cell(
          {
            visit: '방문',
            input_start: '입력 시작',
            input_complete: '입력 완료',
            preview: '무료 결과 열람',
            checkout: '결제 진입',
            paid: '결제 완료',
            refund: '환불',
          }[e.event],
        ),
        cell(e.mode),
        cell(e.count),
      );
      return tr;
    }),
  );
}
$('settings').onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const f = e.target.elements;
    await api('/api/admin/saju/settings', 'PATCH', {
      price: Number(f.price.value),
      free_sections: Number(f.free_sections.value),
      report_version: f.report_version.value,
      sales_enabled: f.sales_enabled.checked,
    });
    $('message').textContent = '설정을 저장했어요. 기존 주문의 가격과 구매 보고서는 유지돼요.';
    await load();
  });
};
$('refresh').onclick = () => run(load);
run(async () => {
  const s = await api('/api/admin/auth/session');
  csrf = s.csrfToken;
  await load();
});
