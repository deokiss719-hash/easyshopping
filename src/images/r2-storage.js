const net = require('node:net');

const REQUIRED_ENV = Object.freeze([
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPrivatePublicHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (net.isIP(host) === 6) return true;
  if (net.isIP(host) !== 4) return false;
  const parts = host.split('.').map(Number);
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function readR2Config(env = process.env) {
  const values = Object.fromEntries(REQUIRED_ENV.map((key) => [key, clean(env[key])]));
  const missing = REQUIRED_ENV.filter((key) => !values[key]);
  if (missing.length) return { enabled: false, missing };

  const publicUrl = new URL(values.R2_PUBLIC_BASE_URL);
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password
    || (publicUrl.port && publicUrl.port !== '443') || publicUrl.search || publicUrl.hash
    || isPrivatePublicHost(publicUrl.hostname)) {
    throw new TypeError('R2_PUBLIC_BASE_URL must be a public HTTPS URL without credentials, query, or fragment');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/i.test(values.R2_ACCOUNT_ID)) {
    throw new TypeError('R2_ACCOUNT_ID is invalid');
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(values.R2_BUCKET_NAME)) {
    throw new TypeError('R2_BUCKET_NAME is invalid');
  }

  return {
    enabled: true,
    accountId: values.R2_ACCOUNT_ID,
    accessKeyId: values.R2_ACCESS_KEY_ID,
    secretAccessKey: values.R2_SECRET_ACCESS_KEY,
    bucketName: values.R2_BUCKET_NAME,
    publicBaseUrl: publicUrl.href.replace(/\/$/, ''),
    endpoint: `https://${values.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

function validObjectKey(key) {
  return typeof key === 'string'
    && /^deals\/[a-z0-9_-]{1,64}\/[a-f0-9]{64}\.webp$/i.test(key)
    && !key.includes('..');
}

function createR2Storage({ config = readR2Config(), client, PutObjectCommand } = {}) {
  if (!config.enabled) {
    return Object.freeze({ enabled: false, reason: 'missing_configuration', missing: config.missing || [] });
  }

  let s3Client = client;
  let Command = PutObjectCommand;
  if (!s3Client || !Command) {
    const sdk = require('@aws-sdk/client-s3');
    Command = sdk.PutObjectCommand;
    s3Client = new sdk.S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return Object.freeze({
    enabled: true,
    async uploadWebp({ key, body }) {
      if (!validObjectKey(key)) throw new TypeError('R2 object key is invalid');
      if (!Buffer.isBuffer(body) || body.length === 0) throw new TypeError('WebP body is required');
      await s3Client.send(new Command({
        Bucket: config.bucketName,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return `${config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
    },
  });
}

module.exports = { REQUIRED_ENV, readR2Config, createR2Storage };
