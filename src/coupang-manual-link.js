const COUPANG_PARTNERS_DISCLOSURE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

function isCoupangPartnerLink(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && url.hostname.toLowerCase() === 'link.coupang.com'
      && /^\/(?:a|re)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  } catch { return false; }
}

module.exports = { COUPANG_PARTNERS_DISCLOSURE, isCoupangPartnerLink };
