const net = require('node:net');

function isUnsafeHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (kind === 6) {
    return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd')
      || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb');
  }
  return false;
}

function safeMerchantUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (isUnsafeHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function hostMatches(hostname, allowedHost) {
  const host = String(hostname || '').toLowerCase();
  const allowed = String(allowedHost || '').toLowerCase();
  return host === allowed || host.endsWith(`.${allowed}`);
}

function validateProvider(provider) {
  if (!provider || typeof provider.name !== 'string' || !provider.name.trim()) {
    throw new TypeError('provider.name is required');
  }
  if (typeof provider.canHandle !== 'function' || typeof provider.fetchImageCandidate !== 'function') {
    throw new TypeError('provider must implement canHandle and fetchImageCandidate');
  }
  if (typeof provider.isAllowedImageUrl !== 'function') {
    throw new TypeError('provider must implement isAllowedImageUrl');
  }
  if (!Array.isArray(provider.merchantHosts) || provider.merchantHosts.length === 0) {
    throw new TypeError('provider.merchantHosts is required');
  }
  const merchantHosts = [...new Set(provider.merchantHosts.map((value) => String(value).trim().toLowerCase()))];
  for (const host of merchantHosts) {
    let parsed;
    try {
      parsed = new URL(`https://${host}`);
    } catch {
      throw new TypeError('provider.merchantHosts contains an invalid hostname');
    }
    if (!host || parsed.hostname !== host || parsed.pathname !== '/' || parsed.search || parsed.hash || isUnsafeHostname(host)) {
      throw new TypeError('provider.merchantHosts contains an invalid hostname');
    }
  }
  return Object.freeze({ ...provider, merchantHosts: Object.freeze(merchantHosts) });
}

function createProviderRegistry(providers = []) {
  const entries = providers.map(validateProvider);
  const merchantHosts = Object.freeze([...new Set(entries.flatMap((provider) => provider.merchantHosts))]);
  return Object.freeze({
    providers: Object.freeze([...entries]),
    merchantHosts,
    find(merchantUrl) {
      const url = safeMerchantUrl(merchantUrl);
      if (!url) return null;
      return entries.find((provider) => {
        if (!provider.merchantHosts.some((host) => hostMatches(url.hostname, host))) return false;
        try {
          return provider.canHandle(url) === true;
        } catch {
          return false;
        }
      }) || null;
    },
  });
}

module.exports = { createProviderRegistry, safeMerchantUrl };
