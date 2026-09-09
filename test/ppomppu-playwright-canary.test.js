'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  decodePpomppuTarget,
  MAX_RSS_BYTES,
  RSS_URL,
  evaluateCanarySnapshot,
  parseFirstRssPostUrl,
  requireHttpUrl,
} = require('../src/ppomppu-playwright-canary');
const {
  collectSnapshot,
  installFailClosedRoute,
  latestPostUrl,
  runCanary,
} = require('../scripts/ppomppu-playwright-canary');

const postUrl = 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=732862';
const auctionUrl = 'http://itempage3.auction.co.kr/DetailView.aspx?itemno=C335952108';
const redirectUrl = `https://s.ppomppu.co.kr/?idno=ppomppu_732862&target=${Buffer.from(auctionUrl).toString('base64')}&encode=on`;

function validSnapshot(overrides = {}) {
  return {
    httpStatus: 200,
    postUrl,
    topTitlePresent: true,
    boardContentsPresent: true,
    topTitleLinkHref: redirectUrl,
    topTitleLinkText: auctionUrl,
    dataUrl: auctionUrl,
    pageText: '공개 핫딜 게시글 본문',
    ...overrides,
  };
}

function rssXml(items) {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items.map((link) => `<item><link><![CDATA[${link}]]></link></item>`).join('')}</channel></rss>`;
}

function mockRssResponse(body, overrides = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    url: RSS_URL,
    headers: new Headers({ 'content-type': 'application/rss+xml; charset=utf-8' }),
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    ...overrides,
  };
}

function makeBrowserMocks(options = {}) {
  const counts = {
    launch: 0, contexts: 0, pages: 0, contextClose: 0, browserClose: 0, continued: 0, aborted: 0,
    webSocketRoutes: 0, webSocketsClosed: 0, unexpectedPagesClosed: 0,
  };
  const context = new EventEmitter();
  const pages = [];
  const order = [];
  let routeHandler;
  let webSocketHandler;
  let contextOptions;
  const mainFrame = {};
  let currentUrl = 'about:blank';

  const values = {
    '#topTitle': { count: 1 },
    '.board-contents': { count: 1 },
    '.topTitle-link a': { count: 1, href: redirectUrl, text: auctionUrl },
    '#div_together_goods-container[data-url]': { count: 1, dataUrl: auctionUrl },
    body: { innerText: '공개 핫딜 게시글 본문' },
  };
  const locator = (selector) => {
    const value = values[selector] || {};
    const loc = {
      first: () => loc,
      count: async () => value.count || 0,
      getAttribute: async (name) => name === 'href' ? value.href ?? null : value.dataUrl ?? null,
      textContent: async () => value.text ?? null,
      innerText: async () => value.innerText ?? '',
    };
    return loc;
  };
  const page = new EventEmitter();
  Object.assign(page, {
    mainFrame: () => mainFrame,
    setDefaultTimeout: () => {},
    url: () => currentUrl,
    locator,
    goto: async (url) => {
      const request = {
        url: () => url,
        resourceType: () => 'document',
        isNavigationRequest: () => true,
        frame: () => mainFrame,
      };
      await routeHandler({
        request: () => request,
        continue: async () => { counts.continued += 1; },
        abort: async () => { counts.aborted += 1; },
      });
      currentUrl = options.pageUrl || url;
      if (options.openPopup) openUnexpectedPage();
      return {
        url: () => options.responseUrl || url,
        status: () => 200,
      };
    },
  });
  const openUnexpectedPage = () => {
    const popup = new EventEmitter();
    popup.close = async () => { counts.unexpectedPagesClosed += 1; };
    pages.push(popup);
    context.emit('page', popup);
    page.emit('popup', popup);
  };
  context.route = (_pattern, handler) => { order.push('route'); routeHandler = handler; };
  context.routeWebSocket = async (pattern, handler) => {
    assert.equal(pattern, '**/*');
    counts.webSocketRoutes += 1;
    order.push('routeWebSocket');
    webSocketHandler = handler;
  };
  context.newPage = async () => {
    order.push('newPage');
    counts.pages += 1;
    pages.push(page);
    context.emit('page', page);
    return page;
  };
  context.pages = () => [...pages];
  context.close = async () => {
    counts.contextClose += 1;
    if (options.latePopup) openUnexpectedPage();
    if (options.contextCloseError) throw new Error(options.contextCloseError);
  };
  const browser = {
    newContext: async (newContextOptions) => {
      counts.contexts += 1;
      contextOptions = newContextOptions;
      return context;
    },
    close: async () => {
      counts.browserClose += 1;
      if (options.browserCloseError) throw new Error(options.browserCloseError);
    },
  };
  const chromiumImpl = {
    launch: async () => { counts.launch += 1; return browser; },
  };
  return {
    chromiumImpl,
    context,
    page,
    counts,
    order,
    getContextOptions: () => contextOptions,
    triggerWebSocket: () => webSocketHandler({ close: () => { counts.webSocketsClosed += 1; } }),
  };
}

function validFetch() {
  return Promise.resolve(mockRssResponse(rssXml([postUrl])));
}

const quietLogger = { log() {}, error() {} };

test('standalone RSS fetch uses only the exact hard-coded HTTPS endpoint', async () => {
  let calledUrl;
  let calledOptions;
  const result = await latestPostUrl(async (url, options) => {
    calledUrl = url;
    calledOptions = options;
    return mockRssResponse(rssXml([postUrl]));
  });
  assert.equal(result, postUrl);
  assert.equal(calledUrl, 'https://www.ppomppu.co.kr/rss.php?id=ppomppu');
  assert.equal(calledOptions.redirect, 'error');

  await assert.rejects(
    latestPostUrl(async () => mockRssResponse(rssXml([postUrl]), { url: `${RSS_URL}&other=1` })),
    /exact configured endpoint/,
  );
});

test('RSS requires XML content type and enforces declared and streamed byte caps', async () => {
  await assert.rejects(
    latestPostUrl(async () => mockRssResponse(rssXml([postUrl]), { headers: new Headers({ 'content-type': 'text/html' }) })),
    /content type must be XML\/RSS/,
  );
  await assert.rejects(
    latestPostUrl(async () => mockRssResponse('', { headers: new Headers({
      'content-type': 'application/xml',
      'content-length': String(MAX_RSS_BYTES + 1),
    }) })),
    /exceeds/,
  );
  const oversized = 'x'.repeat(MAX_RSS_BYTES + 1);
  await assert.rejects(latestPostUrl(async () => mockRssResponse(oversized)), /exceeds/);
});

test('RSS parser uses the first item and fails instead of skipping malformed first item', () => {
  assert.equal(parseFirstRssPostUrl(rssXml([postUrl])), postUrl);
  assert.equal(parseFirstRssPostUrl(rssXml([postUrl.replace(/^https:/, 'http:')])), postUrl);
  assert.throws(
    () => parseFirstRssPostUrl(rssXml(['https://example.com/not-ppomppu', postUrl])),
    /first item link must exactly match/,
  );
  assert.throws(() => parseFirstRssPostUrl('<rss><channel><item>'), /malformed/);
  assert.throws(() => parseFirstRssPostUrl('<rss><channel><item><title>x</title></item></channel></rss>'), /first item link/);
});

test('post identity accepts only the exact canonical positive-integer URL', () => {
  for (const invalid of [
    'http://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1',
    'https://ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1',
    'https://www.ppomppu.co.kr/zboard/view.php?no=1&id=ppomppu',
    'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=0',
    'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=1&extra=1',
  ]) assert.throws(() => evaluateCanarySnapshot(validSnapshot({ postUrl: invalid })), /exactly match/);
});

test('merchant URL permits HTTP but rejects credentials, local names, every literal IP, and unsafe ports', () => {
  assert.equal(requireHttpUrl('http://example.com/deal', 'merchant'), 'http://example.com/deal');
  for (const unsafe of [
    'https://user:pass@example.com/',
    'http://localhost/deal',
    'http://localhost.../deal',
    'http://shop.localhost/deal',
    'http://printer/deal',
    'http://shop.local/deal',
    'http://service.internal/deal',
    'http://router.home.arpa/deal',
    'http://127.0.0.1/deal',
    'http://10.1.2.3/deal',
    'http://172.16.0.1/deal',
    'http://192.168.1.1/deal',
    'http://169.254.1.2/deal',
    'http://8.8.8.8/deal',
    'http://[::1]/deal',
    'http://[::ffff:127.0.0.1]/deal',
    'http://[fc00::1]/deal',
    'http://[fe80::1]/deal',
    'http://[2001:4860:4860::8888]/deal',
    'https://example.com:8443/deal',
  ]) assert.throws(() => requireHttpUrl(unsafe, 'merchant'), /credentials|public multi-label hostname|unsafe port/);
});

test('s.ppomppu decoding preserves Base64 plus and rejects duplicate, non-canonical, and malformed UTF-8 targets', () => {
  const plusTarget = 'aHR0cHM6Ly9leGFtcGxlLmNvbS9kZWFsP3E94KC+';
  assert.equal(
    decodePpomppuTarget(`https://s.ppomppu.co.kr./?target=${plusTarget}`),
    'https://example.com/deal?q=%E0%A0%BE',
  );
  assert.throws(
    () => decodePpomppuTarget(`https://s.ppomppu.co.kr/?target=${plusTarget}&target=${plusTarget}`),
    /duplicated/,
  );
  assert.throws(() => decodePpomppuTarget('https://s.ppomppu.co.kr/?target=Zg'), /invalid/);
  assert.throws(() => decodePpomppuTarget('https://s.ppomppu.co.kr/?target=Zh=='), /invalid/);
  assert.throws(() => decodePpomppuTarget('https://s.ppomppu.co.kr/?target=wyg='), /invalid UTF-8/);
});

test('trailing dots are normalized for s.ppomppu and ppomppu merchant identity checks', () => {
  const dottedRedirect = redirectUrl.replace('s.ppomppu.co.kr', 's.ppomppu.co.kr...');
  assert.equal(evaluateCanarySnapshot(validSnapshot({ topTitleLinkHref: dottedRedirect })).success, true);

  const internal = 'https://shop.ppomppu.co.kr.../deal';
  assert.throws(() => evaluateCanarySnapshot(validSnapshot({
    topTitleLinkHref: internal,
    topTitleLinkText: internal,
    dataUrl: internal,
  })), /external/);
});

test('three matching purchase-link values produce the external merchant identity', () => {
  assert.deepEqual(evaluateCanarySnapshot(validSnapshot()), {
    success: true,
    playwrightSuccess: true,
    postUrl,
    httpStatus: 200,
    topTitleLinkPresent: true,
    merchantUrl: auctionUrl,
    merchantDomain: 'itempage3.auction.co.kr',
    dataUrlMatches: true,
    captchaOrRestriction: false,
    verdict: 'success',
  });
});

test('mismatched candidates, restrictions, missing DOM, or non-200 fail', () => {
  assert.throws(() => evaluateCanarySnapshot(validSnapshot({ dataUrl: 'https://example.com/' })), /do not match/);
  assert.throws(() => evaluateCanarySnapshot(validSnapshot({ pageText: '비정상적인 접근으로 서비스 이용이 제한되었습니다.' })), /restriction/);
  assert.throws(() => evaluateCanarySnapshot(validSnapshot({ httpStatus: 403 })), /HTTP 200/);
  assert.throws(() => evaluateCanarySnapshot(validSnapshot({ topTitlePresent: false })), /#topTitle/);
  assert.throws(() => evaluateCanarySnapshot(validSnapshot({ boardContentsPresent: false })), /.board-contents/);
  assert.throws(() => evaluateCanarySnapshot(validSnapshot({ topTitleLinkHref: null })), /.topTitle-link/);
});

test('route is fail-closed: only the first exact main-frame document is continued', async () => {
  let handler;
  const context = { route: (_glob, routeHandler) => { handler = routeHandler; } };
  const mainFrame = {};
  const page = { mainFrame: () => mainFrame };
  const state = await installFailClosedRoute(context, postUrl, () => page);

  async function issue({ url = postUrl, type = 'document', navigation = true, frame = mainFrame } = {}) {
    let action;
    await handler({
      request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation, frame: () => frame }),
      continue: async () => { action = 'continue'; },
      abort: async () => { action = 'abort'; },
    });
    return action;
  }

  assert.equal(await issue(), 'continue');
  assert.equal(await issue(), 'abort');
  for (const type of ['script', 'document', 'xhr', 'fetch', 'image', 'font', 'media', 'stylesheet']) {
    assert.equal(await issue({ type, url: type === 'document' ? `${postUrl}0` : 'https://ads.example/x' }), 'abort');
  }
  assert.equal(state.getAllowedDocumentRequests(), 1);
});

test('collectSnapshot rejects response redirects and page URL identity changes', async () => {
  const first = makeBrowserMocks({ responseUrl: `${postUrl}&redirected=1` });
  await installFailClosedRoute(first.context, postUrl, () => first.page);
  first.context.newPage = async () => first.page;
  await assert.rejects(collectSnapshot(first.page, postUrl), /response URL/);

  const second = makeBrowserMocks({ pageUrl: `${postUrl}#changed` });
  await installFailClosedRoute(second.context, postUrl, () => second.page);
  await assert.rejects(collectSnapshot(second.page, postUrl), /page URL/);
});

test('run disables JavaScript, closes websockets, uses one page, never navigates merchant, and rejects popups', async () => {
  const normal = makeBrowserMocks();
  const success = await runCanary({
    chromiumImpl: normal.chromiumImpl,
    fetchImpl: validFetch,
    logger: quietLogger,
    setProcessExitCode: false,
  });
  assert.equal(success.success, true);
  assert.deepEqual(normal.getContextOptions(), { javaScriptEnabled: false });
  assert.deepEqual(normal.order, ['routeWebSocket', 'route', 'newPage']);
  normal.triggerWebSocket();
  assert.deepEqual(normal.counts, {
    launch: 1, contexts: 1, pages: 1, contextClose: 1, browserClose: 1, continued: 1, aborted: 0,
    webSocketRoutes: 1, webSocketsClosed: 1, unexpectedPagesClosed: 0,
  });
  assert.equal(success.postUrl, postUrl);

  const popup = makeBrowserMocks({ openPopup: true });
  const failure = await runCanary({
    chromiumImpl: popup.chromiumImpl,
    fetchImpl: validFetch,
    logger: quietLogger,
    setProcessExitCode: false,
  });
  assert.equal(failure.success, false);
  assert.match(failure.reason, /additional page or popup/);
  assert.equal(popup.counts.unexpectedPagesClosed, 1);
});

test('a page event during cleanup deterministically turns a completed run into failure', async () => {
  const latePopup = makeBrowserMocks({ latePopup: true });
  const result = await runCanary({
    chromiumImpl: latePopup.chromiumImpl,
    fetchImpl: validFetch,
    logger: quietLogger,
    setProcessExitCode: false,
  });
  assert.equal(result.success, false);
  assert.match(result.reason, /additional page or popup/);
  assert.equal(latePopup.counts.unexpectedPagesClosed, 1);
});

test('context and browser cleanup errors deterministically turn success into one failure result', async () => {
  const mocks = makeBrowserMocks({ contextCloseError: 'context boom', browserCloseError: 'browser boom' });
  const output = [];
  const result = await runCanary({
    chromiumImpl: mocks.chromiumImpl,
    fetchImpl: validFetch,
    logger: { log: (line) => output.push(line), error: (line) => output.push(line) },
    setProcessExitCode: false,
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'cleanup failed: context.close: context boom; browser.close: browser boom');
  assert.equal(output.length, 1);
  assert.match(output[0], /^PPOMPPU_CANARY_RESULT /);
});
