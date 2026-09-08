const test = require('node:test');
const assert = require('node:assert/strict');

const { createProviderRegistry } = require('../src/images/provider-registry');
const { createImagePipeline, runImageBackfill, ImageFailureCache } = require('../src/images/image-pipeline');
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
  assert.deepEqual(calls[2], ['resize', { width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }]);
  assert.deepEqual(calls[3], ['webp', { quality: 82, effort: 4 }]);
  await assert.rejects(() => convertToWebp(Buffer.alloc(10 * 1024 * 1024 + 1), { sharpImpl }), /too large/);
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

test('provider가 아직 없으면 DB 상태를 고정하지 않아 향후 provider 추가 시 재처리할 수 있다', async () => {
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
  assert.deepEqual(updates, []);
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
