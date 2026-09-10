const test = require('node:test');
const assert = require('node:assert/strict');

const { readR2Config, createR2Storage } = require('../src/images/r2-storage');

test('R2 환경변수가 하나라도 없으면 안전하게 비활성화한다', () => {
  const empty = readR2Config({});
  assert.equal(empty.enabled, false);
  assert.deepEqual(empty.missing.sort(), [
    'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_PUBLIC_BASE_URL', 'R2_SECRET_ACCESS_KEY',
  ]);

  const partial = readR2Config({ R2_ACCOUNT_ID: 'account' });
  assert.equal(partial.enabled, false);
  assert.ok(partial.missing.includes('R2_BUCKET_NAME'));
});

test('R2 공개 URL은 HTTPS만 허용하고 자격증명은 결과에 노출하지 않는다', () => {
  const env = {
    R2_ACCOUNT_ID: 'account-id',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
    R2_BUCKET_NAME: 'easyshopping-images',
    R2_PUBLIC_BASE_URL: 'https://images.example.com/base/',
  };
  const config = readR2Config(env);
  assert.deepEqual(config, {
    enabled: true,
    accountId: 'account-id',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    bucketName: 'easyshopping-images',
    publicBaseUrl: 'https://images.example.com/base',
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
  });
  assert.throws(() => readR2Config({ ...env, R2_PUBLIC_BASE_URL: 'http://images.example.com' }), /HTTPS/);
  assert.throws(() => readR2Config({ ...env, R2_PUBLIC_BASE_URL: 'https://images.example.com/base?token=x' }), /query/);
  assert.throws(() => readR2Config({ ...env, R2_PUBLIC_BASE_URL: 'https://images.example.com/base#fragment' }), /fragment/);
  assert.throws(() => readR2Config({ ...env, R2_PUBLIC_BASE_URL: 'https://127.0.0.1/base' }), /public HTTPS/);
  assert.throws(() => readR2Config({ ...env, R2_PUBLIC_BASE_URL: 'https://localhost/base' }), /public HTTPS/);
});

test('R2 adapter는 WebP와 장기 캐시 헤더로 업로드하고 자체 공개 URL만 반환한다', async () => {
  const sent = [];
  class PutObjectCommand {
    constructor(input) { this.input = input; }
  }
  const client = { send: async (command) => sent.push(command.input) };
  const storage = createR2Storage({
    config: {
      enabled: true,
      bucketName: 'bucket',
      publicBaseUrl: 'https://images.example.com',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      accountId: 'account', accessKeyId: 'key', secretAccessKey: 'secret',
    },
    client,
    PutObjectCommand,
  });

  const key = `deals/feed/${'a'.repeat(64)}.webp`;
  assert.equal(Object.isFrozen(storage), true);
  assert.equal(storage.publicUrlForKey(key), `https://images.example.com/${key}`);
  const url = await storage.uploadWebp({ key, body: Buffer.from('webp') });

  assert.equal(url, `https://images.example.com/${key}`);
  assert.deepEqual(sent[0], {
    Bucket: 'bucket',
    Key: key,
    Body: Buffer.from('webp'),
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  });
  await assert.rejects(() => storage.uploadWebp({ key: '../secret.webp', body: Buffer.from('x') }), /key/);
  assert.throws(() => storage.publicUrlForKey('../secret.webp'), /key/);
});
