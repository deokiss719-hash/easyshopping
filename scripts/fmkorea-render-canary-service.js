'use strict';

const http = require('node:http');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const {
  FMKOREA_ENDPOINT,
  parseFmkoreaHotdealHtml,
} = require('../src/fmkorea-collector');

const BLOCKED_STATUSES = new Set([403, 429, 430]);

function countRecognizableRows(html) {
  const $ = cheerio.load(String(html || ''), null, false);
  let count = 0;
  $('li').each((_index, element) => {
    const tokens = String($(element).attr('class') || '').trim().split(/\s+/).filter(Boolean);
    const required = ['li', 'li_best2_pop0', 'li_best2_hotdeal0'];
    if (required.every((token) => tokens.includes(token))
      && tokens.every((token) => token === 'li' || /^li_best2_(?:pop|hotdeal|politics)\d+$/.test(token))) {
      count += 1;
    }
  });
  return count;
}

async function runCanary() {
  const result = {
    targetUrl: FMKOREA_ENDPOINT,
    phase: 'browser-launch',
    chromiumLaunchError: null,
    httpStatus: null,
    is403: false,
    is429: false,
    is430: false,
    blockedStatus: false,
    allowedMainDocumentRequests: 0,
    rowCount: null,
    parsedCount: null,
    success: false,
    error: null,
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    result.chromiumLaunchError = String(error?.message || error);
    result.error = 'Chromium launch failed';
    return result;
  }

  let context;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    let permittedMainDocument = false;

    await page.route('**/*', async (route) => {
      const request = route.request();
      const isExactInitialDocument = !permittedMainDocument
        && request.isNavigationRequest()
        && request.frame() === page.mainFrame()
        && request.method() === 'GET'
        && request.url() === FMKOREA_ENDPOINT;
      if (isExactInitialDocument) {
        permittedMainDocument = true;
        result.allowedMainDocumentRequests += 1;
        await route.continue();
      } else {
        await route.abort('blockedbyclient');
      }
    });

    result.phase = 'navigation';
    const response = await page.goto(FMKOREA_ENDPOINT, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    result.httpStatus = response ? response.status() : null;
    result.is403 = result.httpStatus === 403;
    result.is429 = result.httpStatus === 429;
    result.is430 = result.httpStatus === 430;
    result.blockedStatus = BLOCKED_STATUSES.has(result.httpStatus);

    result.phase = 'dom-validation';
    const html = await page.content();
    result.rowCount = countRecognizableRows(html);
    result.parsedCount = 0;
    const parsed = parseFmkoreaHotdealHtml(html, new Date());
    result.parsedCount = parsed.length;
    result.success = result.httpStatus === 200 && result.parsedCount >= 10;
    result.phase = 'complete';
  } catch (error) {
    result.error = String(error?.message || error);
    if (BLOCKED_STATUSES.has(Number(error?.status))) result.blockedStatus = true;
  } finally {
    try { await context?.close(); } catch { /* best effort */ }
    try { await browser.close(); } catch { /* best effort */ }
  }
  return result;
}

const port = Number(process.env.PORT || 10000);
let state = { status: 'running', result: null };
const server = http.createServer((_request, response) => {
  response.writeHead(state.status === 'complete' ? 200 : 202, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(state));
});

server.listen(port, '0.0.0.0', async () => {
  console.log(`FMKOREA_CANARY_SERVICE listening on ${port}`);
  const result = await runCanary();
  state = { status: 'complete', result };
  console.log(`[FMKOREA_CANARY_RESULT] ${JSON.stringify(result)}`);
});
