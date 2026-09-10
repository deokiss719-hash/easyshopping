const test = require('node:test');
const assert = require('node:assert/strict');

const { createProviderRegistry } = require('../src/images/provider-registry');
const {
  createImagePipeline,
  runImageBackfill,
  ImageFailureCache,
  ImageBackfillCircuitBreaker,
  runGuardedImageBackfill,
} = require('../src/images/image-pipeline');
const { convertToWebp } = require('../src/images/webp');

test('provider registry는 실제 HTTPS 판매처 URL이 있을 때만 provider를 선택한다', () => {
  const provider = {
    name: 'official-shop',
    merchantHosts: ['shop.example'],
    canHandle: (url) => url.hostname === 'shop.example',
    isAllowedImageUrl: (url) => url.hostname === 'shop.example',
    fetchImageCandidate: async () => null,
  };
  const registry = createProviderRegistry([provider]);

  assert.equal(registry.find('https://shop.example/products/1')?.name, provider.name);
  assert.deepEqual(registry.merchantHosts, ['shop.example']);
  assert.equal(registry.find(null), null);
  assert.equal(registry.find('http://shop.example/products/1'), null);
  assert.equal(registry.find('https://user:pass@shop.example/products/1'), null);
  assert.equal(registry.find('https://127.0.0.1/products/1'), null);
  assert.equal(registry.find('not-a-url'), null);
});

test('WebP 변환은 크기를 제한하고 메타데이터를 제거하는 sharp 옵션을 사용한다', async () => {
  const calls = [];
  const pipeline = {
    async metadata() { calls.push(['metadata']); return { format: 'jpeg', width: 120, height: 100 }; },
    rotate() { calls.push(['rotate']); return this; },
    resize(options) { calls.push(['resize', options]); return this; },
    webp(options) { calls.push(['webp', options]); return this; },
    toBuffer: async () => Buffer.from('webp-image'),
  };
  const sharpImpl = (input, options) => {
    calls.push(['sharp', input.length, options]);
    return pipeline;
  };

  const result = await convertToWebp(Buffer.from('source-image'), { sharpImpl });

  assert.equal(result.toString(), 'webp-image');
  assert.deepEqual(calls[0], ['sharp', 12, { limitInputPixels: 40000000, sequentialRead: true }]);
  assert.deepEqual(calls[1], ['metadata']);
  assert.deepEqual(calls[3], ['resize', { width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }]);
  assert.deepEqual(calls[4], ['webp', { quality: 82, effort: 4 }]);
  await assert.rejects(() => convertToWebp(Buffer.alloc(10 * 1024 * 1024 + 1), { sharpImpl }), /too large/);
});

test('WebP 변환은 디코딩된 JPEG/PNG/WebP/GIF/AVIF만 허용한다', async () => {
  function sharpFor(metadata) {
    return () => ({
      metadata: async () => metadata,
      rotate() { return this; },
      resize() { return this; },
      webp() { return this; },
      toBuffer: async () => Buffer.from('webp'),
    });
  }
  for (const format of ['jpeg', 'png', 'webp', 'gif']) {
    await assert.doesNotReject(() => convertToWebp(Buffer.from('input'), {
      sharpImpl: sharpFor({ format, width: 100, height: 100 }),
    }));
  }
  await assert.doesNotReject(() => convertToWebp(Buffer.from('input'), {
    sharpImpl: sharpFor({ format: 'heif', compression: 'av1', mediaType: 'image/avif', width: 100, height: 100 }),
  }));
  for (const metadata of [
    { format: 'svg' },
    { format: 'tiff' },
    { format: 'heif', compression: 'hevc', mediaType: 'image/heic' },
    { format: 'heif', compression: 'av1', mediaType: 'image/heic' },
    { format: 'avif' },
    {},
  ]) {
    await assert.rejects(() => convertToWebp(Buffer.from('input'), {
      sharpImpl: sharpFor({ ...metadata, width: 100, height: 100 }),
    }), /unsupported decoded image format/);
  }
});

test('실제 이미지가 80x80 미만이면 WebP 변환과 R2 업로드 전에 거부한다', async () => {
  const sharp = require('sharp');
  const tinyImage = await sharp({
    create: { width: 79, height: 100, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  let uploads = 0;
  const provider = {
    name: 'official-shop',
    merchantHosts: ['shop.example'],
    canHandle: () => true,
    isAllowedImageUrl: () => true,
    fetchImageCandidate: async () => ({
      body: tinyImage,
      contentType: 'image/png',
      sourceImageUrl: 'https://shop.example/tiny.png',
    }),
  };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([provider]),
    storage: { enabled: true, uploadWebp: async () => { uploads += 1; } },
    store: { updateImageState: async () => {} },
    logger: { warn() {} },
  });

  const result = await pipeline.process({
    id: 'tiny', source: 'feed', sourceItemId: 'tiny', merchantUrl: 'https://shop.example/tiny',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'image_too_small');
  assert.equal(uploads, 0);
});

test('R2가 비활성화되거나 판매처 URL이 없으면 provider와 저장소를 호출하지 않는다', async () => {
  let providerCalls = 0;
  let uploads = 0;
  const provider = {
    name: 'official-shop',
    merchantHosts: ['shop.example'],
    canHandle: () => true,
    isAllowedImageUrl: () => true,
    fetchImageCandidate: async () => { providerCalls += 1; },
  };
  const registry = createProviderRegistry([provider]);
  const storage = { enabled: false, uploadWebp: async () => { uploads += 1; } };
  const pipeline = createImagePipeline({ providerRegistry: registry, storage });

  assert.deepEqual(await pipeline.process({ id: '1', source: 'feed', sourceItemId: '1', merchantUrl: null }), { status: 'missing_merchant_url' });
  assert.deepEqual(await pipeline.process({ id: '2', source: 'feed', sourceItemId: '2', merchantUrl: 'https://shop.example/2' }), { status: 'disabled' });
  assert.equal(providerCalls, 0);
  assert.equal(uploads, 0);
});

test('판매처 URL이 없어도 원문 URL provider로 본문 이미지를 R2에 저장한다', async () => {
  const calls = [];
  const updates = [];
  const provider = {
    name: 'ppomppu-source-post',
    merchantHosts: ['ppomppu.co.kr'],
    canHandle: (url) => url.hostname.endsWith('ppomppu.co.kr'),
    isAllowedImageUrl: (url) => url.hostname.endsWith('ppomppu.co.kr'),
    fetchImageCandidate: async (input) => {
      calls.push(input);
      return {
        body: Buffer.from('png'),
        contentType: 'image/png',
        sourceImageUrl: 'https://cdn4.ppomppu.co.kr/zboard/data3/product.png',
      };
    },
  };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([provider]),
    storage: { enabled: true, uploadWebp: async ({ key }) => `https://images.example/${key}` },
    store: { updateImageState: async (id, update) => updates.push([id, update]) },
    convert: async () => Buffer.from('webp'),
  });
  const deal = {
    id: '3',
    source: 'ppomppu',
    sourceItemId: '123',
    originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123',
    merchantUrl: null,
  };

  const result = await pipeline.process(deal);

  assert.equal(result.status, 'ready');
  assert.equal(calls[0].sourceUrl, deal.originalUrl);
  assert.equal(calls[0].merchantUrl, null);
  assert.equal(updates[0][1].imageProvider, 'ppomppu-source-post');
});

test('판매처 URL이 있어도 검증된 원문 URL provider를 우선 선택한다', async () => {
  const called = [];
  const sourceProvider = {
    name: 'ppomppu-source-post',
    merchantHosts: ['ppomppu.co.kr'],
    canHandle: (url) => url.hostname.endsWith('ppomppu.co.kr'),
    isAllowedImageUrl: (url) => url.hostname.endsWith('ppomppu.co.kr'),
    fetchImageCandidate: async ({ sourceUrl, merchantUrl }) => {
      called.push(['source', sourceUrl, merchantUrl]);
      return {
        body: Buffer.from('png'), contentType: 'image/png',
        sourceImageUrl: 'https://cdn4.ppomppu.co.kr/zboard/data3/product.png',
      };
    },
  };
  const merchantProvider = {
    name: 'official-shop',
    merchantHosts: ['shop.example'],
    canHandle: (url) => url.hostname === 'shop.example',
    isAllowedImageUrl: () => true,
    fetchImageCandidate: async () => { called.push(['merchant']); },
  };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([sourceProvider, merchantProvider]),
    storage: { enabled: true, uploadWebp: async () => 'https://images.example/image.webp' },
    store: { updateImageState: async () => {} },
    convert: async () => Buffer.from('webp'),
  });
  const deal = {
    id: 'source-first', source: 'ppomppu', sourceItemId: '123',
    originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123',
    merchantUrl: 'https://shop.example/products/123',
  };

  const result = await pipeline.process(deal);

  assert.equal(result.provider, 'ppomppu-source-post');
  assert.deepEqual(called, [['source', deal.originalUrl, deal.merchantUrl]]);
});

test('확정된 판매처 URL의 provider 결과만 WebP로 변환해 R2 URL과 상태를 저장한다', async () => {
  const updates = [];
  const provider = {
    name: 'official-shop',
    merchantHosts: ['shop.example'],
    canHandle: (url) => url.hostname === 'shop.example',
    isAllowedImageUrl: (url) => url.hostname === 'shop.example',
    fetchImageCandidate: async ({ merchantUrl }) => ({
      body: Buffer.from('jpeg'),
      contentType: 'image/jpeg',
      sourceImageUrl: `${merchantUrl}/image.jpg`,
    }),
  };
  const storage = {
    enabled: true,
    uploadWebp: async ({ key, body }) => {
      assert.match(key, /^deals\/feed\/[a-f0-9]{64}\.webp$/);
      assert.equal(body.toString(), 'converted');
      return `https://images.example/${key}`;
    },
  };
  const store = { updateImageState: async (id, update) => updates.push([id, update]) };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([provider]),
    storage,
    store,
    convert: async () => Buffer.from('converted'),
  });

  const result = await pipeline.process({ id: '7', source: 'feed', sourceItemId: 'item-7', merchantUrl: 'https://shop.example/products/7' });

  assert.equal(result.status, 'ready');
  assert.equal(result.provider, 'official-shop');
  assert.equal(updates[0][0], '7');
  assert.equal(updates[0][1].imageStatus, 'ready');
  assert.equal(updates[0][1].sourceImageUrl, 'https://shop.example/products/7/image.jpg');
  assert.match(updates[0][1].imageUrl, /^https:\/\/images\.example\/deals\/feed\//);
});

test('provider가 아직 없으면 재시도 시각을 저장해 같은 후보가 배치를 계속 막지 않는다', async () => {
  const updates = [];
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([]),
    storage: { enabled: true },
    store: { updateImageState: async (...args) => updates.push(args) },
  });

  assert.deepEqual(
    await pipeline.process({ id: '8', source: 'feed', sourceItemId: 'item-8', merchantUrl: 'https://shop.example/products/8' }),
    { status: 'unsupported_provider' },
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], '8');
  assert.equal(updates[0][1].imageStatus, 'unsupported_provider');
  assert.equal(updates[0][1].imageFailureCode, 'unsupported_provider');
  assert.match(updates[0][1].imageRetryAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(updates[0][2], { onlyIfImageMissing: true });
});

test('본문 이미지가 없으면 상세 실패 코드를 보존한다', async () => {
  const updates = [];
  const provider = {
    name: 'ppomppu-source-post',
    merchantHosts: ['ppomppu.co.kr'],
    canHandle: () => true,
    isAllowedImageUrl: () => true,
    fetchImageCandidate: async () => {
      throw Object.assign(new Error('본문 상품 이미지가 없습니다'), { code: 'body_image_missing' });
    },
  };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([provider]),
    storage: { enabled: true },
    store: { updateImageState: async (...args) => updates.push(args) },
    logger: { warn() {} },
  });

  const result = await pipeline.process({
    id: 'missing-body',
    source: 'ppomppu',
    sourceItemId: '123',
    originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=123',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'body_image_missing');
  assert.equal(updates[0][1].imageFailureCode, 'body_image_missing');
});

test('원본 이미지 URL이 변경되면 R2 캐시 키도 변경한다', async () => {
  let sourceImageUrl = 'https://cdn.shop.example/images/a.jpg';
  const keys = [];
  const provider = {
    name: 'official-shop',
    merchantHosts: ['shop.example'],
    canHandle: () => true,
    isAllowedImageUrl: (url) => url.hostname === 'cdn.shop.example',
    fetchImageCandidate: async () => ({ body: Buffer.from('jpeg'), contentType: 'image/jpeg', sourceImageUrl }),
  };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([provider]),
    storage: {
      enabled: true,
      uploadWebp: async ({ key }) => {
        keys.push(key);
        return `https://images.example/${key}`;
      },
    },
    store: { updateImageState: async () => {} },
    convert: async () => Buffer.from('converted'),
  });
  const deal = { id: '9', source: 'feed', sourceItemId: 'item-9', merchantUrl: 'https://shop.example/products/9' };

  await pipeline.process(deal);
  sourceImageUrl = 'https://cdn.shop.example/images/b.jpg';
  await pipeline.process(deal);

  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test('실패 캐시는 재시도 시각 전 provider 재호출을 막고 backfill은 제한된 후보만 처리한다', async () => {
  const cache = new ImageFailureCache({ retryMs: 60_000, now: () => 1_000 });
  cache.record('feed:item-1');
  assert.equal(cache.canAttempt('feed:item-1'), false);
  cache.now = () => 61_001;
  assert.equal(cache.canAttempt('feed:item-1'), true);

  const processed = [];
  const result = await runImageBackfill({
    store: { listImageBackfillCandidates: async ({ limit }) => {
      assert.equal(limit, 2);
      return [{ id: '1' }, { id: '2' }];
    } },
    pipeline: { enabled: true, process: async (deal) => { processed.push(deal.id); return { status: 'ready' }; } },
    limit: 2,
    concurrency: 1,
  });
  assert.deepEqual(processed, ['1', '2']);
  assert.deepEqual(result, { status: 'completed', selected: 2, ready: 2, failed: 0, skipped: 0 });
});

test('403·429 회로 차단기는 쿨다운 동안 새 후보 처리도 막는다', () => {
  let now = 1_000;
  const breaker = new ImageBackfillCircuitBreaker({
    cooldownMs: 60_000,
    now: () => now,
  });

  assert.equal(breaker.canAttempt(), true);
  assert.equal(breaker.record('provider_error'), null);
  assert.equal(breaker.canAttempt(), true);
  for (const code of ['page_http_403', 'page_http_429', 'image_http_403', 'image_http_429']) {
    breaker.blockedUntil = 0;
    assert.equal(breaker.record(code), '1970-01-01T00:01:01.000Z');
    assert.equal(breaker.canAttempt(), false);
  }
  now = 61_001;
  assert.equal(breaker.canAttempt(), true);
});

test('원문 403이 발생하면 저속 backfill은 즉시 중단하고 남은 후보를 건너뛴다', async () => {
  const processed = [];
  const delays = [];
  const result = await runImageBackfill({
    store: { listImageBackfillCandidates: async () => [{ id: '1' }, { id: '2' }, { id: '3' }] },
    pipeline: {
      enabled: true,
      process: async (deal) => {
        processed.push(deal.id);
        if (deal.id === '2') return { status: 'failed', code: 'page_http_403' };
        return { status: 'ready' };
      },
    },
    limit: 3,
    concurrency: 1,
    delayMs: 2_000,
    sleep: async (ms) => delays.push(ms),
    stopOnFailureCodes: ['page_http_403'],
  });

  assert.deepEqual(processed, ['1', '2']);
  assert.deepEqual(delays, [2_000]);
  assert.deepEqual(result, {
    status: 'halted', selected: 3, ready: 1, failed: 1, skipped: 1, haltedCode: 'page_http_403',
  });
});

test('동시 작업이 먼저 이미지를 준비하면 늦은 실패는 stale로 건너뛴다', async () => {
  const updates = [];
  const provider = {
    name: 'official-shop',
    merchantHosts: ['shop.example'],
    canHandle: () => true,
    isAllowedImageUrl: () => true,
    fetchImageCandidate: async () => { throw new Error('late failure'); },
  };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([provider]),
    storage: { enabled: true },
    store: {
      updateImageState: async (...args) => {
        updates.push(args);
        return null;
      },
    },
    logger: { warn() {} },
  });

  const result = await pipeline.process({
    id: 'race', source: 'feed', sourceItemId: 'race', merchantUrl: 'https://shop.example/race',
  });

  assert.deepEqual(result, { status: 'stale', provider: 'official-shop' });
  assert.equal(updates[0][2].onlyIfImageMissing, true);
});

test('403 감지 후 DB 상태 저장이 실패해도 차단 코드를 보존하고 DB 오류를 숨기지 않는다', async () => {
  const databaseError = new Error('database unavailable');
  const provider = {
    name: 'ppomppu-source-post', merchantHosts: ['ppomppu.co.kr'], canHandle: () => true,
    isAllowedImageUrl: () => true,
    fetchImageCandidate: async () => { throw Object.assign(new Error('forbidden'), { code: 'page_http_403' }); },
  };
  const pipeline = createImagePipeline({
    providerRegistry: createProviderRegistry([provider]), storage: { enabled: true },
    store: { updateImageState: async () => { throw databaseError; } }, logger: { warn() {} },
  });
  await assert.rejects(
    () => pipeline.process({
      id: '403', source: 'ppomppu', sourceItemId: '403',
      originalUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=403',
    }),
    (error) => error === databaseError && error.detectedFailureCode === 'page_http_403',
  );
});

test('공유 cooldown은 다른 인스턴스와 새 후보도 막는다', async () => {
  let sharedRetryAt = null;
  let candidateLists = 0;
  const store = {
    withImageBackfillLease: async (worker) => worker(),
    getImageBackfillCooldown: async () => sharedRetryAt,
    recordImageBackfillCooldown: async (_code, retryAt) => { sharedRetryAt = retryAt; return retryAt; },
    listImageBackfillCandidates: async () => {
      candidateLists += 1;
      return candidateLists === 1 ? [{ id: 'old' }] : [{ id: 'new' }];
    },
  };
  const first = await runGuardedImageBackfill({
    store,
    breaker: new ImageBackfillCircuitBreaker({ now: () => Date.parse('2026-09-10T00:00:00Z') }),
    pipeline: { enabled: true, process: async () => ({ status: 'failed', code: 'page_http_403' }) }, limit: 1,
  });
  assert.equal(first.status, 'halted');
  assert.equal(sharedRetryAt, '2026-09-10T06:00:00.000Z');
  const second = await runGuardedImageBackfill({
    store,
    breaker: new ImageBackfillCircuitBreaker({ now: () => Date.parse('2026-09-10T01:00:00Z') }),
    pipeline: { enabled: true, process: async () => ({ status: 'ready' }) }, limit: 1,
  });
  assert.deepEqual(second, { status: 'cooldown', retryAt: sharedRetryAt, selected: 0, ready: 0, failed: 0, skipped: 0 });
  assert.equal(candidateLists, 1);
});

test('guarded backfill은 cooldown 저장 실패가 원래 403 연계 오류를 가리지 않는다', async () => {
  const originalError = Object.assign(new Error('image state write failed'), { detectedFailureCode: 'page_http_403' });
  const cooldownError = new Error('cooldown write failed');
  const store = {
    withImageBackfillLease: async (worker) => worker(),
    getImageBackfillCooldown: async () => null,
    recordImageBackfillCooldown: async () => { throw cooldownError; },
    listImageBackfillCandidates: async () => [{ id: '1' }],
  };
  await assert.rejects(
    () => runGuardedImageBackfill({
      store,
      breaker: new ImageBackfillCircuitBreaker(),
      pipeline: { enabled: true, process: async () => { throw originalError; } },
      limit: 1,
    }),
    (error) => error === originalError && error.cooldownPersistenceError === cooldownError,
  );
});

test('정상 403 중단 뒤 cooldown 저장 실패에도 403 진단 코드를 보존한다', async () => {
  const cooldownError = new Error('cooldown write failed');
  const store = {
    withImageBackfillLease: async (worker) => worker(),
    getImageBackfillCooldown: async () => null,
    recordImageBackfillCooldown: async () => { throw cooldownError; },
    listImageBackfillCandidates: async () => [{ id: '1' }],
  };
  await assert.rejects(
    () => runGuardedImageBackfill({
      store,
      breaker: new ImageBackfillCircuitBreaker(),
      pipeline: { enabled: true, process: async () => ({ status: 'failed', code: 'page_http_403' }) },
      limit: 1,
    }),
    (error) => error === cooldownError && error.detectedFailureCode === 'page_http_403',
  );
});

test('guarded backfill은 advisory lease를 얻지 못한 인스턴스에서 실행되지 않는다', async () => {
  let listed = false;
  const result = await runGuardedImageBackfill({
    store: {
      withImageBackfillLease: async () => null,
      listImageBackfillCandidates: async () => { listed = true; return []; },
    },
    breaker: new ImageBackfillCircuitBreaker(),
    pipeline: { enabled: true, process: async () => ({ status: 'ready' }) },
  });
  assert.deepEqual(result, { status: 'locked', selected: 0, ready: 0, failed: 0, skipped: 0 });
  assert.equal(listed, false);
});

test('guarded backfill은 이미지 HTTP 429에서도 즉시 중단하고 공유 cooldown을 기록한다', async () => {
  const recorded = [];
  const store = {
    withImageBackfillLease: async (worker) => worker(),
    getImageBackfillCooldown: async () => null,
    recordImageBackfillCooldown: async (code, retryAt) => {
      recorded.push([code, retryAt]);
      return retryAt;
    },
    listImageBackfillCandidates: async ({ source }) => {
      assert.equal(source, 'ppomppu');
      return [{ id: '1' }, { id: '2' }];
    },
  };
  const breaker = new ImageBackfillCircuitBreaker({
    cooldownMs: 60_000,
    now: () => 1_000,
  });

  const result = await runGuardedImageBackfill({
    store,
    breaker,
    pipeline: { enabled: true, process: async () => ({ status: 'failed', code: 'image_http_429' }) },
    source: 'ppomppu',
    limit: 2,
  });

  assert.equal(result.status, 'halted');
  assert.equal(result.haltedCode, 'image_http_429');
  assert.equal(result.skipped, 1);
  assert.deepEqual(recorded, [['image_http_429', '1970-01-01T00:01:01.000Z']]);
});
