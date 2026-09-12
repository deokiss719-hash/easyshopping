function buildContentSecurityPolicy(r2Config = { enabled: false }, naverShoppingConfig = { enabled: false }) {
  const imageSources = [
    "'self'",
    'https://ppomppu.co.kr',
    'https://*.ppomppu.co.kr',
    'https://image.fmkorea.com',
    'https://ext.fmkorea.com',
    'https://*.coupangcdn.com',
    'https://www.facebook.com',
  ];
  if (r2Config.enabled && r2Config.publicBaseUrl) {
    imageSources.push(new URL(r2Config.publicBaseUrl).origin);
  }
  if (Array.isArray(naverShoppingConfig.imageBaseUrls)) {
    for (const baseUrl of naverShoppingConfig.imageBaseUrls) {
      const origin = new URL(baseUrl).origin;
      if (!imageSources.includes(origin)) imageSources.push(origin);
    }
  }
  return [
    "default-src 'self'",
    `img-src ${imageSources.join(' ')}`,
    "style-src 'self' https://cdn.jsdelivr.net",
    "font-src 'self' https://cdn.jsdelivr.net",
    "script-src 'self' https://connect.facebook.net",
    "connect-src 'self' https://www.facebook.com",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

module.exports = { buildContentSecurityPolicy };
