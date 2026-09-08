function buildContentSecurityPolicy(r2Config = { enabled: false }) {
  const imageSources = ["'self'", 'https://ppomppu.co.kr', 'https://*.ppomppu.co.kr'];
  if (r2Config.enabled && r2Config.publicBaseUrl) {
    imageSources.push(new URL(r2Config.publicBaseUrl).origin);
  }
  return [
    "default-src 'self'",
    `img-src ${imageSources.join(' ')}`,
    "style-src 'self' https://cdn.jsdelivr.net",
    "font-src 'self' https://cdn.jsdelivr.net",
    "script-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

module.exports = { buildContentSecurityPolicy };
