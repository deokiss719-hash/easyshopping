'use strict';

const { chromium } = require('playwright');
const {
  RSS_URL,
  evaluateCanarySnapshot,
  parseFirstRssPostUrl,
  readCappedBody,
  requirePostUrl,
  validateRssResponse,
} = require('../src/ppomppu-playwright-canary');

const NAVIGATION_TIMEOUT_MS = Number(process.env.PPOMPPU_CANARY_TIMEOUT_MS || 30000);

async function latestPostUrl(fetchImpl = fetch) {
  const response = await fetchImpl(RSS_URL, {
    headers: { accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' },
    redirect: 'error',
    signal: AbortSignal.timeout(NAVIGATION_TIMEOUT_MS),
  });
  validateRssResponse(response);
  return parseFirstRssPostUrl(await readCappedBody(response));
}

async function installFailClosedRoute(context, expectedPostUrl, getPage) {
  requirePostUrl(expectedPostUrl);
  let allowedDocumentRequests = 0;

  const handler = async (route) => {
    const request = route.request();
    let isAllowed = false;
    try {
      const page = getPage();
      isAllowed = allowedDocumentRequests === 0
        && request.url() === expectedPostUrl
        && request.resourceType() === 'document'
        && request.isNavigationRequest()
        && page
        && request.frame() === page.mainFrame();
    } catch {
      isAllowed = false;
    }

    if (isAllowed) {
      allowedDocumentRequests += 1;
      await route.continue();
    } else {
      await route.abort();
    }
  };
  await context.route('**/*', handler);
  return { handler, getAllowedDocumentRequests: () => allowedDocumentRequests };
}

async function collectSnapshot(page, postUrl, assertSinglePage = () => {}) {
  requirePostUrl(postUrl);
  const response = await page.goto(postUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  assertSinglePage();
  if (!response) throw new Error('main document did not return a response');
  if (response.url() !== postUrl) throw new Error('main response URL did not remain the exact expected post');
  if (page.url() !== postUrl) throw new Error('page URL did not remain the exact expected post');

  const topTitle = page.locator('#topTitle');
  const boardContents = page.locator('.board-contents');
  const topTitleLink = page.locator('.topTitle-link a').first();
  const purchaseData = page.locator('#div_together_goods-container[data-url]').first();

  const topTitleLinkPresent = await topTitleLink.count() > 0;
  const snapshot = {
    postUrl,
    httpStatus: response.status(),
    topTitlePresent: await topTitle.count() > 0,
    boardContentsPresent: await boardContents.count() > 0,
    topTitleLinkHref: topTitleLinkPresent ? await topTitleLink.getAttribute('href') : null,
    topTitleLinkText: topTitleLinkPresent ? (await topTitleLink.textContent())?.trim() : null,
    dataUrl: await purchaseData.count() > 0 ? await purchaseData.getAttribute('data-url') : null,
    pageText: await page.locator('body').innerText().catch(() => ''),
  };
  assertSinglePage();
  if (page.url() !== postUrl) throw new Error('page URL did not remain the exact expected post');
  return snapshot;
}

function failureResult(error, postUrl, snapshot) {
  return {
    success: false,
    playwrightSuccess: false,
    postUrl,
    httpStatus: snapshot?.httpStatus ?? null,
    topTitleLinkPresent: Boolean(snapshot?.topTitleLinkHref),
    merchantDomain: null,
    dataUrlMatches: false,
    captchaOrRestriction: /CAPTCHA or access restriction/.test(error.message),
    verdict: 'failure',
    reason: error.message,
  };
}

async function runCanary(options = {}) {
  const chromiumImpl = options.chromiumImpl || chromium;
  const fetchImpl = options.fetchImpl || fetch;
  const logger = options.logger || console;
  const setProcessExitCode = options.setProcessExitCode !== false;
  let browser;
  let context;
  let page;
  let postUrl = null;
  let snapshot = null;
  let result = null;
  let runError = null;
  let unexpectedPage = null;
  const cleanupErrors = [];
  const closingUnexpectedPages = new WeakSet();

  const reportUnexpectedPage = (openedPage) => {
    if (!unexpectedPage) unexpectedPage = new Error('additional page or popup detected');
    if (!openedPage || (typeof openedPage === 'object' && closingUnexpectedPages.has(openedPage))) return;
    try {
      if (typeof openedPage === 'object') closingUnexpectedPages.add(openedPage);
      Promise.resolve(openedPage?.close?.()).catch(() => {});
    } catch {
      // Best-effort close; the unexpected page already makes the run fail closed.
    }
  };

  try {
    postUrl = await latestPostUrl(fetchImpl);
    browser = await chromiumImpl.launch({ headless: true, channel: 'chromium' });
    context = await browser.newContext({ javaScriptEnabled: false });

    context.on('page', (openedPage) => {
      if (page && openedPage !== page) reportUnexpectedPage(openedPage);
    });
    await context.routeWebSocket('**/*', (webSocket) => webSocket.close());
    const routeState = await installFailClosedRoute(context, postUrl, () => page);
    page = await context.newPage();
    page.on('popup', reportUnexpectedPage);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    const assertSinglePage = () => {
      if (unexpectedPage || context.pages().length !== 1) {
        throw unexpectedPage || new Error('additional page or popup detected');
      }
    };
    assertSinglePage();
    snapshot = await collectSnapshot(page, postUrl, assertSinglePage);
    assertSinglePage();
    if (routeState.getAllowedDocumentRequests() !== 1) {
      throw new Error('exactly one main document request was not observed');
    }
    result = evaluateCanarySnapshot(snapshot);
  } catch (error) {
    runError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (error) {
        cleanupErrors.push(`context.close: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        cleanupErrors.push(`browser.close: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (unexpectedPage) {
    runError = unexpectedPage;
    result = null;
  }
  if (cleanupErrors.length) {
    const cleanupMessage = `cleanup failed: ${cleanupErrors.join('; ')}`;
    runError = new Error(runError ? `${runError.message}; ${cleanupMessage}` : cleanupMessage);
    result = null;
  }
  if (runError) result = failureResult(runError, postUrl, snapshot);

  const output = `PPOMPPU_CANARY_RESULT ${JSON.stringify(result)}`;
  if (result.success) logger.log(output);
  else {
    logger.error(output);
    if (setProcessExitCode) process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  runCanary();
}

module.exports = {
  collectSnapshot,
  installFailClosedRoute,
  latestPostUrl,
  runCanary,
};
