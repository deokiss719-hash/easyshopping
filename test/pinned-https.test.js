const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPinnedLookup,
  resolvePublic,
  requestPinnedHttps,
} = require('../src/pinned-https');

test('resolvePublic은 DNS mixed answer와 특수 목적 IPv4/IPv6를 모두 거부한다', async () => {
  const url = new URL('https://feed.example/rss');
  for (const addresses of [
    [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
    [{ address: '169.254.169.254', family: 4 }],
    [{ address: '192.0.2.1', family: 4 }],
    [{ address: '::1', family: 6 }],
    [{ address: 'fe80::1', family: 6 }],
    [{ address: '2001:db8::1', family: 6 }],
  ]) {
    await assert.rejects(() => resolvePublic(url, async () => addresses), /public addresses/);
  }
});

test('requestPinnedHttps는 검증한 IP 하나만 transport lookup에 제공하고 원래 host/SNI URL을 보존한다', async () => {
  const calls = [];
  const response = { status: 200 };
  const actual = await requestPinnedHttps(new URL('https://www.ppomppu.co.kr/rss.php?id=ppomppu'), {
    lookup: async (hostname) => {
      assert.equal(hostname, 'www.ppomppu.co.kr');
      return [{ address: '93.184.216.34', family: 4 }];
    },
    request: async (url, selected, options) => {
      calls.push({ url, selected, options });
      return response;
    },
    headers: { Accept: 'application/rss+xml' },
    signal: { marker: true },
  });
  assert.equal(actual, response);
  assert.equal(calls[0].url.hostname, 'www.ppomppu.co.kr');
  assert.deepEqual(calls[0].selected, { address: '93.184.216.34', family: 4 });
  assert.equal(calls[0].options.signal.marker, true);

  const pinnedLookup = createPinnedLookup(calls[0].selected);
  await new Promise((resolve, reject) => pinnedLookup('www.ppomppu.co.kr', { all: true }, (error, addresses) => {
    if (error) reject(error);
    else {
      assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
      resolve();
    }
  }));
});
