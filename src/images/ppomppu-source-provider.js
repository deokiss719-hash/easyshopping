const { fetchPpomppuBodyImage, safeImageUrl } = require('../rss-collector');

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_HOSTS = Object.freeze(['ppomppu.co.kr']);
const ALLOWED_PAGE_HOSTS = Object.freeze(['www.ppomppu.co.kr', 'ppomppu.co.kr']);

function isPpomppuHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'ppomppu.co.kr' || host.endsWith('.ppomppu.co.kr');
}

function isAllowedPostUrl(url) {
  return url instanceof URL
    && url.protocol === 'https:'
    && !url.username
    && !url.password
    && (!url.port || url.port === '443')
    && isPpomppuHost(url.hostname)
    && url.pathname === '/zboard/view.php'
    && url.searchParams.get('id') === 'ppomppu'
    && /^\d{1,20}$/.test(url.searchParams.get('no') || '');
}

function isAllowedImageUrl(url) {
  return url instanceof URL
    && url.protocol === 'https:'
    && !url.username
    && !url.password
    && (!url.port || url.port === '443')
    && isPpomppuHost(url.hostname)
    && /^\/zboard\/data\d*\//i.test(url.pathname);
}

async function cancelBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Best-effort cleanup only.
  }
}

async function readLimitedBuffer(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelBody(response);
    throw new RangeError('image response is too large');
  }
  if (!response.body?.getReader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) throw new RangeError('image response is too large');
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError('image response is too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchImage(urlValue, {
  fetchImpl,
  referer,
  maxImageBytes,
  timeoutMs,
}) {
  let url = new URL(urlValue);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedImageUrl(url)) throw Object.assign(new Error('허용되지 않은 뽐뿌 이미지 URL입니다'), { code: 'unsafe_source_image_url' });
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
        Referer: referer,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
      },
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location');
      await cancelBody(response);
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error('뽐뿌 이미지 리다이렉트가 안전하지 않습니다');
      const redirected = safeImageUrl(location, url.href, ALLOWED_HOSTS);
      if (!redirected) throw Object.assign(new Error('허용되지 않은 뽐뿌 이미지 리다이렉트입니다'), { code: 'unsafe_source_image_url' });
      url = new URL(redirected);
      continue;
    }
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`뽐뿌 이미지 HTTP ${response.status}`);
    }
    const contentType = response.headers?.get?.('content-type') || '';
    if (!/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/i.test(contentType)) {
      await cancelBody(response);
      throw new Error('unsupported image content type');
    }
    return {
      body: await readLimitedBuffer(response, maxImageBytes),
      contentType,
      sourceImageUrl: url.href,
    };
  }
  throw new Error('뽐뿌 이미지 리다이렉트가 너무 많습니다');
}

function createPpomppuImageProvider({
  fetchImpl = fetch,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  timeoutMs = 8000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes < 1024) throw new TypeError('maxImageBytes is invalid');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100) throw new TypeError('timeoutMs is invalid');

  return Object.freeze({
    name: 'ppomppu-source-post',
    merchantHosts: ALLOWED_HOSTS,
    canHandle: isAllowedPostUrl,
    isAllowedImageUrl,
    async fetchImageCandidate({ deal } = {}) {
      let postUrl;
      try {
        postUrl = new URL(deal?.originalUrl);
      } catch {
        throw Object.assign(new Error('유효한 뽐뿌 원문 URL이 필요합니다'), { code: 'unsafe_source_image_url' });
      }
      if (!isAllowedPostUrl(postUrl)) {
        throw Object.assign(new Error('허용되지 않은 뽐뿌 원문 URL입니다'), { code: 'unsafe_source_image_url' });
      }

      const discoveredImage = await fetchPpomppuBodyImage(postUrl.href, {
        allowedHosts: ALLOWED_PAGE_HOSTS,
        allowedImageHosts: ALLOWED_HOSTS,
        fetchImpl,
        timeoutMs,
      });
      if (!discoveredImage || !isAllowedImageUrl(new URL(discoveredImage))) {
        throw new Error('뽐뿌 본문 상품 이미지가 없습니다');
      }
      return fetchImage(discoveredImage, {
        fetchImpl,
        referer: postUrl.href,
        maxImageBytes,
        timeoutMs,
      });
    },
  });
}

module.exports = { createPpomppuImageProvider, isAllowedPostUrl, isAllowedImageUrl };
