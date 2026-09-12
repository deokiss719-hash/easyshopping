const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const metaEvents = fs.readFileSync(path.join(root, 'public/meta-events.js'), 'utf8');
const { createMetaEventTracker } = require('../public/meta-events');

test('Meta 이벤트 모듈은 앱보다 먼저 한 번 로드되고 검색 실행 지점에만 연결된다', () => {
  assert.equal((html.match(/<script src="\/meta-events\.js" defer><\/script>/g) || []).length, 1);
  assert.ok(html.indexOf('/meta-events.js') < html.indexOf('/app.js'));
  assert.match(app, /window\.MetaEvents\?\.trackSearch\(state\.query\)/);
});

test('비어 있지 않은 검색은 원문이나 추가 매개변수 없이 Search 표준 이벤트만 전송한다', () => {
  const calls = [];
  const tracker = createMetaEventTracker((...args) => calls.push(args));

  assert.equal(tracker.trackSearch('  아이폰  '), true);
  assert.deepEqual(calls, [['track', 'Search']]);
});

test('Search 전송 순간에는 URL의 검색어만 제거하고 다른 상태와 원래 URL은 보존한다', () => {
  const location = { href: 'https://easyshoopping.com/?q=%EB%AF%BC%EA%B0%90%ED%95%9C%EA%B2%80%EC%83%89&sort=price-low#all-deals' };
  const replacements = [];
  const history = {
    state: { page: 1 },
    replaceState(state, _title, nextUrl) {
      location.href = new URL(nextUrl, location.href).href;
      replacements.push({ state, href: location.href });
    },
  };
  const urlsAtCall = [];
  const pixel = (...args) => urlsAtCall.push({ args, href: location.href });
  pixel.callMethod = () => {};
  const tracker = createMetaEventTracker(pixel, { location, history, requireLoaded: true });

  assert.equal(tracker.trackSearch('민감한검색'), true);
  assert.equal(urlsAtCall.length, 1);
  assert.equal(new URL(urlsAtCall[0].href).searchParams.has('q'), false);
  assert.equal(new URL(urlsAtCall[0].href).searchParams.get('sort'), 'price-low');
  assert.equal(new URL(urlsAtCall[0].href).hash, '#all-deals');
  assert.equal(location.href, 'https://easyshoopping.com/?q=%EB%AF%BC%EA%B0%90%ED%95%9C%EA%B2%80%EC%83%89&sort=price-low#all-deals');
  assert.equal(replacements.length, 2);
});

test('Meta 외부 스크립트가 준비되지 않았으면 URL이 복구된 뒤 읽히는 큐에 Search를 남기지 않는다', () => {
  const calls = [];
  const pixel = (...args) => calls.push(args);
  const tracker = createMetaEventTracker(pixel, { requireLoaded: true });

  assert.equal(tracker.trackSearch('아이폰'), false);
  assert.deepEqual(calls, []);
});

test('같은 검색어의 연속 실행은 중복 전송하지 않고 모든 UI 초기화 경로가 상태를 재설정한다', () => {
  const calls = [];
  const tracker = createMetaEventTracker((...args) => calls.push(args));

  assert.equal(tracker.trackSearch('갤럭시'), true);
  assert.equal(tracker.trackSearch('  갤럭시  '), false);
  tracker.resetSearch();
  assert.equal(tracker.trackSearch('갤럭시'), true);
  assert.deepEqual(calls, [['track', 'Search'], ['track', 'Search']]);
  assert.match(app, /if \(!state\.query\) window\.MetaEvents\?\.resetSearch\(\)/);
  assert.match(app, /#resetSearch[\s\S]*window\.MetaEvents\?\.resetSearch\(\)/);
});

test('픽셀 함수가 없거나 값이 문자열이 아니어도 검색 기능에 예외를 전파하지 않는다', () => {
  const tracker = createMetaEventTracker(null);
  assert.equal(tracker.trackSearch('아이폰'), false);
  assert.equal(tracker.trackSearch(null), false);
  assert.equal(tracker.trackSearch({ toString() { throw new Error('do not coerce'); } }), false);
});

test('구매·결제·장바구니·리드 등 사이트에 없는 표준 이벤트는 설치하지 않는다', () => {
  const combined = `${html}\n${app}\n${metaEvents}`;
  for (const event of ['ViewContent', 'Contact', 'Lead', 'AddToCart', 'InitiateCheckout', 'Purchase']) {
    assert.doesNotMatch(combined, new RegExp(`['"]${event}['"]`));
  }
});
