function normalizeKakaoChannelUrl(value) {
  if (typeof value !== 'string') throw new TypeError('카카오채널 주소를 입력해 주세요.');
  const input = value.trim();
  if (!input) return '';
  let url;
  try { url = new URL(/^pf\.kakao\.com\//i.test(input) ? `https://${input}` : input); }
  catch { throw new TypeError('카카오채널 주소를 확인해 주세요. 예: https://pf.kakao.com/_채널ID'); }
  if (url.hostname === 'open.kakao.com') throw new TypeError('오픈채팅방 주소예요. 개인 견적 상담을 위해 카카오채널의 홈 또는 1:1 채팅 주소를 입력해 주세요.');
  const match = url.pathname.match(/^\/(_[A-Za-z0-9-]+)(?:\/(?:chat|friend))?\/?$/);
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'pf.kakao.com' || url.username || url.password || url.port || !match) {
    throw new TypeError('카카오채널 홈 또는 1:1 채팅 주소를 입력해 주세요. 예: https://pf.kakao.com/_채널ID');
  }
  return `https://pf.kakao.com/${match[1]}/chat`;
}
module.exports = { normalizeKakaoChannelUrl };
