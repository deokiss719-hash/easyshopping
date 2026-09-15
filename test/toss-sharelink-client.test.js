const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BEST_SELLING_URL,
  LINK_URL,
  TOKEN_URL,
  createFileTokenCache,
  createTossSharelinkClient,
} = require('../src/toss-sharelink-client');

function response(body) { return { statusCode: 200, headers: {}, body }; }

test('client calls only fixed OAuth, global best-selling, and link endpoints with bounded safe options', async () => {
  const calls = [];
  const transport = async (options) => {
    calls.push(options);
    if (options.url === TOKEN_URL) return response({ access_token: 'token-value', token_type: 'Bearer', expires_in: 3600 });
    if (options.url.startsWith(`${BEST_SELLING_URL}?size=`)) return response({ resultType: 'SUCCESS', success: { items: [], hasNext: false, nextCursor: null } });
    if (options.url === LINK_URL) return response({ resultType: 'SUCCESS', success: { shortUrl: 'https://toss.im/_m/abc', originUrl: 'https://toss.shopping/product/1' } });
    throw new Error('unexpected endpoint');
  };
  const client = createTossSharelinkClient({ accessKey: 'access-secret', secretKey: 'secret-secret', publisherId: 'member-secret', transport });
  await client.fetchBestSelling({ size: 100 });
  await client.createLink({ tacaItemId: 12345 });

  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [[TOKEN_URL, 'POST'], [`${BEST_SELLING_URL}?size=100`, 'GET'], [LINK_URL, 'POST']]);
  const tokenCall = calls[0];
  assert.equal(Object.hasOwn(tokenCall.headers, 'authorization'), false);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tokenCall.body)), {
    grant_type: 'client_credentials',
    client_id: 'access-secret',
    client_secret: 'secret-secret',
    scope: 'sharelink:read sharelink:write',
  });
  for (const call of calls) {
    assert.equal(call.timeoutMs > 0 && call.timeoutMs <= 15_000, true);
    assert.equal(call.maxResponseBytes > 0 && call.maxResponseBytes <= 1_000_000, true);
    assert.equal(call.followRedirects, false);
  }
  const linkBody = JSON.parse(calls[2].body);
  assert.deepEqual(linkBody, { tacaItemId: 12345, publisherId: 'member-secret' });
  assert.equal(Object.hasOwn(linkBody, 'productUrl'), false);
  assert.doesNotMatch(JSON.stringify(calls.map((call) => call.url)), /category|daily|detail/);
});

test('token is cached across clients and cache is an atomic 0600 file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toss-token-'));
  const filename = path.join(dir, 'token.json');
  let tokenCalls = 0;
  const transport = async (options) => {
    if (options.url === TOKEN_URL) {
      tokenCalls += 1;
      return response({ access_token: 'reused-token', token_type: 'Bearer', expires_in: 31_536_000 });
    }
    return response({ resultType: 'SUCCESS', success: { items: [], hasNext: false, cursor: null } });
  };
  const options = { accessKey: 'ak', secretKey: 'sk', publisherId: 'pid', transport, now: () => new Date('2026-09-15T00:00:00Z') };
  await createTossSharelinkClient({ ...options, tokenCache: createFileTokenCache(filename) }).fetchBestSelling({ size: 1 });
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['token.json']);
  await createTossSharelinkClient({ ...options, tokenCache: createFileTokenCache(filename) }).fetchBestSelling({ size: 1 });
  assert.equal(tokenCalls, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('malformed/non-SUCCESS responses, wrong short URL hosts, redirects, and oversized responses fail closed without leaking secrets', async () => {
  const secrets = ['access-secret', 'secret-secret', 'member-secret', 'token-secret'];
  const cases = [
    response({ resultType: 'FAIL', error: { reason: 'nope' } }),
    response({ resultType: 'SUCCESS', success: { shortUrl: 'https://evil.example/_m/x', originUrl: 'https://x' } }),
    { statusCode: 302, headers: { location: 'https://evil.example' }, body: {} },
    Object.assign(new Error(`transport failed ${secrets.join(' ')}`), { code: 'ECONNRESET' }),
  ];
  for (const outcome of cases) {
    const transport = async (options) => {
      if (options.url === TOKEN_URL) return response({ access_token: 'token-secret', token_type: 'Bearer', expires_in: 3600 });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    };
    const client = createTossSharelinkClient({ accessKey: secrets[0], secretKey: secrets[1], publisherId: secrets[2], transport });
    let error;
    try { await client.createLink({ tacaItemId: 'one' }); } catch (caught) { error = caught; }
    assert.ok(error);
    for (const secret of secrets) assert.equal(String(error.message).includes(secret), false);
  }
});

test('size is constrained to official 1..100 range and IDs cannot alter fixed URLs', async () => {
  const client = createTossSharelinkClient({ accessKey: 'a', secretKey: 's', publisherId: 'p', transport: async () => { throw new Error('must not call'); } });
  for (const size of [0, 101, 1.5, '1']) await assert.rejects(() => client.fetchBestSelling({ size }), /size/i);
  for (const id of ['', null, '12345', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(() => client.createLink({ tacaItemId: id }), /tacaItemId/i);
  }
});

test('share links require the exact https://toss.im origin without a nonstandard port', async () => {
  const transport = async (options) => {
    if (options.url === TOKEN_URL) return response({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 });
    return response({ resultType: 'SUCCESS', success: { shortUrl: 'https://toss.im:444/_m/abc', originUrl: 'https://toss.shopping/product/1' } });
  };
  const client = createTossSharelinkClient({ accessKey: 'a', secretKey: 's', publisherId: 'p', transport });
  await assert.rejects(() => client.createLink({ tacaItemId: 1 }), /invalid short URL/i);
});
