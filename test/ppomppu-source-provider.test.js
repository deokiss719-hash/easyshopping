const test = require('node:test');
const assert = require('node:assert/strict');

const { createPpomppuImageProvider } = require('../src/images/ppomppu-source-provider');

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
  const provider = createPpomppuImageProvider({ fetchImpl });

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
    /본문 상품 이미지가 없습니다/,
  );
  assert.equal(calls, 1);
});

test('저장된 sourceImageUrl을 재사용하지 않고 원문 본문에서 매번 이미지를 다시 확정한다', async () => {
  const calls = [];
  const currentImage = 'https://cdn4.ppomppu.co.kr/zboard/data3/current.jpg';
  const provider = createPpomppuImageProvider({
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
