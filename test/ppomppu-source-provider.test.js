const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const {
  createPpomppuImageProvider,
  decodeInlineImageData,
} = require('../src/images/ppomppu-source-provider');

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const inlinePng = (body = PNG_SIGNATURE) => `data:image/png;base64,${body.toString('base64')}`;

test('뽐뿌 본문 안의 안전한 data:image PNG를 네트워크 재요청 없이 전달한다', async () => {
  const body = await require('sharp')({
    create: { width: 80, height: 80, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  let calls = 0;
  const provider = createPpomppuImageProvider({
    requestIntervalMs: 0,
    lookup: publicLookup,
    fetchImpl: async () => {
      calls += 1;
      return new Response(`<td class="board-contents"><img src="${inlinePng(body)}"></td>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  const candidate = await provider.fetchImageCandidate({
    deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
  });

  assert.equal(calls, 1);
  assert.deepEqual(candidate.body, body);
  assert.equal(candidate.contentType, 'image/png');
  assert.equal(candidate.sourceImageUrl, null);
  assert.equal(candidate.sourceImageKey, `inline-sha256:${createHash('sha256').update(body).digest('hex')}`);
});

test('data:image는 strict base64, MIME allowlist, 디코딩 전후 크기, 실제 형식을 fail-closed 검증한다', async () => {
  const cases = [
    { value: 'data:image/png;base64,%%%not-base64%%%', code: 'body_image_invalid_data' },
    { value: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`, code: 'body_image_unsupported_type' },
    { value: `data:image/png;base64,${Buffer.from('not-a-png').toString('base64')}`, code: 'body_image_invalid_data' },
    { value: inlinePng(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(1024)])), code: 'body_image_too_large', maxImageBytes: 1024 },
  ];

  for (const fixture of cases) {
    const provider = createPpomppuImageProvider({
      requestIntervalMs: 0,
      maxImageBytes: fixture.maxImageBytes || 10 * 1024 * 1024,
      lookup: publicLookup,
      fetchImpl: async () => new Response(
        `<td class="board-contents"><img src="${fixture.value}"></td>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    });
    await assert.rejects(
      () => provider.fetchImageCandidate({
        deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
      }),
      (error) => error?.code === fixture.code,
      fixture.code,
    );
  }
});

test('기본 10MiB 제한보다 디코딩 결과가 큰 data:image는 디코딩 전에 거부한다', () => {
  const oversized = Buffer.alloc((10 * 1024 * 1024) + 1).toString('base64');
  assert.throws(
    () => decodeInlineImageData(`data:image/png;base64,${oversized}`),
    (error) => error?.code === 'body_image_too_large',
  );
});

test('본문 밖 data:image는 제외하고 본문 컨테이너 없음과 안전하지 않은 호스트를 구분한다', async () => {
  const fixtures = [
    { html: `<img src="${inlinePng()}"><table><tr><td class="board-contents"><p>본문</p></td></tr></table>`, code: 'body_image_missing' },
    { html: '<div class="deleted">삭제된 게시물</div>', code: 'body_content_missing' },
    { html: '<td class="board-contents"><img src="https://img.ppomppu1.co.kr/zboard/data3/product.jpg"></td>', code: 'body_image_unsafe_source' },
  ];
  for (const fixture of fixtures) {
    let calls = 0;
    const provider = createPpomppuImageProvider({
      requestIntervalMs: 0,
      lookup: publicLookup,
      fetchImpl: async () => {
        calls += 1;
        return new Response(fixture.html, { status: 200, headers: { 'content-type': 'text/html' } });
      },
    });
    await assert.rejects(
      () => provider.fetchImageCandidate({
        deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
      }),
      (error) => error?.code === fixture.code,
      fixture.code,
    );
    assert.equal(calls, 1);
  }
});

test('뽐뿌 원문 provider는 본문 첫 사용자 이미지를 내려받아 배치 파이프라인에 전달한다', async () => {
  const calls = [];
  const html = `
    <table><tr><td class="board-contents">
      <img src="/images/icon_expand_img.png">
      <img src="//cdn4.ppomppu.co.kr/zboard/data3/2026/0909/product.jpg">
    </td></tr></table>`;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=euc-kr' } });
    }
    return new Response(Buffer.from('jpeg-image'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const provider = createPpomppuImageProvider({ fetchImpl, lookup: publicLookup, requestIntervalMs: 0 });

  assert.equal(provider.canHandle(new URL('https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123')), true);
  assert.equal(provider.canHandle(new URL('https://example.com/deal/123')), false);

  const candidate = await provider.fetchImageCandidate({
    deal: {
      originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123',
    },
  });

  assert.equal(candidate.sourceImageUrl, 'https://cdn4.ppomppu.co.kr/zboard/data3/2026/0909/product.jpg');
  assert.equal(candidate.contentType, 'image/jpeg');
  assert.equal(candidate.body.toString(), 'jpeg-image');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.redirect, 'manual');
});

test('뽐뿌 원문 provider는 본문 밖 이미지와 허용 호스트 밖 이미지에 접근하지 않는다', async () => {
  let calls = 0;
  const provider = createPpomppuImageProvider({
    requestIntervalMs: 0,
    lookup: publicLookup,
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        '<img src="https://cdn4.ppomppu.co.kr/ad.jpg"><table><tr><td class="board-contents"><img src="https://evil.example/product.jpg"></td></tr></table>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
  });

  await assert.rejects(
    () => provider.fetchImageCandidate({ deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' } }),
    (error) => error?.code === 'body_image_unsafe_source',
  );
  assert.equal(calls, 1);
});

test('원문 HTTP 실패는 민감한 응답 없이 안전한 상태 코드로 분류한다', async () => {
  const provider = createPpomppuImageProvider({
    requestIntervalMs: 0,
    lookup: publicLookup,
    fetchImpl: async () => new Response('blocked', {
      status: 403,
      headers: { 'content-type': 'text/html' },
    }),
  });

  await assert.rejects(
    () => provider.fetchImageCandidate({
      deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
    }),
    (error) => error?.code === 'page_http_403',
  );
});

test('저장된 sourceImageUrl을 재사용하지 않고 원문 본문에서 매번 이미지를 다시 확정한다', async () => {
  const calls = [];
  const currentImage = 'https://cdn4.ppomppu.co.kr/zboard/data3/current.jpg';
  const provider = createPpomppuImageProvider({
    requestIntervalMs: 0,
    lookup: publicLookup,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return new Response(`<td class="board-contents"><img src="${currentImage}"></td>`, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(Buffer.from('current-image'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    },
  });

  const candidate = await provider.fetchImageCandidate({
    deal: {
      originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123',
      sourceImageUrl: 'https://cdn4.ppomppu.co.kr/zboard/data3/stale-rss-image.jpg',
    },
  });

  assert.deepEqual(calls, [
    'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123',
    currentImage,
  ]);
  assert.equal(candidate.sourceImageUrl, currentImage);
});

test('원문 페이지 리다이렉트는 매 hop마다 정확한 뽐뿌 게시글 경로를 검증한다', async () => {
  for (const location of [
    '/zboard/list.php?id=ppomppu&no=123',
    '/zboard/view.php?id=freeboard&no=123',
    '/zboard/view.php?id=ppomppu&no=not-a-number',
  ]) {
    let calls = 0;
    const provider = createPpomppuImageProvider({
      requestIntervalMs: 0,
      lookup: publicLookup,
      fetchImpl: async () => {
        calls += 1;
        const nextLocation = calls === 1
          ? '/zboard/view.php?id=ppomppu&no=123'
          : location;
        return new Response(null, { status: 302, headers: { location: nextLocation } });
      },
    });

    await assert.rejects(
      () => provider.fetchImageCandidate({
        deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
      }),
      /Page URL is not allowed/,
    );
    assert.equal(calls, 2);
  }
});

test('원문 페이지 리다이렉트가 다른 게시글 번호로 바뀌면 이미지를 연결하지 않는다', async () => {
  let calls = 0;
  const provider = createPpomppuImageProvider({
    requestIntervalMs: 0,
    lookup: publicLookup,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: '/zboard/view.php?id=ppomppu&no=124' },
      });
    },
  });

  await assert.rejects(
    () => provider.fetchImageCandidate({
      deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
    }),
    /Page URL is not allowed/,
  );
  assert.equal(calls, 1);
});

test('뽐뿌 원문 페이지 응답에 Content-Type이 없으면 본문을 사용하지 않는다', async () => {
  let calls = 0;
  const provider = createPpomppuImageProvider({
    requestIntervalMs: 0,
    lookup: publicLookup,
    fetchImpl: async () => {
      calls += 1;
      return new Response(Buffer.from('<td class="board-contents"><img src="https://cdn4.ppomppu.co.kr/zboard/data3/product.jpg"></td>'));
    },
  });

  await assert.rejects(
    () => provider.fetchImageCandidate({
      deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
    }),
    /본문 상품 이미지가 없습니다/,
  );
  assert.equal(calls, 1);
});

test('운영 Node 스트림 이미지도 청크 단위 제한을 적용하고 초과 즉시 중단한다', async () => {
  let calls = 0;
  let destroyed = false;
  let arrayBufferCalled = false;
  const oversizedBody = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(700);
      yield Buffer.alloc(700);
    },
    destroy() { destroyed = true; },
  };
  const provider = createPpomppuImageProvider({
    requestIntervalMs: 0,
    maxImageBytes: 1024,
    lookup: publicLookup,
    request: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('<td class="board-contents"><img src="https://cdn4.ppomppu.co.kr/zboard/data3/product.jpg"></td>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        body: oversizedBody,
        async arrayBuffer() {
          arrayBufferCalled = true;
          return Buffer.alloc(1400);
        },
      };
    },
  });

  await assert.rejects(
    () => provider.fetchImageCandidate({
      deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
    }),
    /image response is too large/,
  );
  assert.equal(arrayBufferCalled, false);
  assert.equal(destroyed, true);
});

test('5초 pacing을 게시글·이미지·각 redirect의 실제 outbound HTTP 경계에 적용한다', async () => {
  let now = 0;
  const requestTimes = [];
  const requestSignals = [];
  const responses = [
    () => new Response(null, { status: 302, headers: { location: '/zboard/view.php?id=ppomppu&no=123' } }),
    () => new Response('<td class="board-contents"><img src="https://cdn4.ppomppu.co.kr/zboard/data3/product.jpg"></td>', {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
    () => new Response(null, { status: 302, headers: { location: 'https://cdn5.ppomppu.co.kr/zboard/data3/product.jpg' } }),
    () => new Response(Buffer.from('image'), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  ];
  const provider = createPpomppuImageProvider({
    lookup: publicLookup,
    fetchImpl: async (_url, options) => {
      requestTimes.push(now);
      requestSignals.push(options.signal);
      return responses.shift()();
    },
    requestIntervalMs: 5_000,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  await provider.fetchImageCandidate({
    deal: { originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123' },
  });
  assert.deepEqual(requestTimes, [0, 5_000, 10_000, 15_000]);
  assert.equal(new Set(requestSignals).size, 4);
});
