(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DealValue = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  // Only parse an unambiguous Toss listing: one size followed by one pack count.
  function unitPrice(deal) {
    if (deal.source !== 'toss' || !Number.isSafeInteger(deal.price) || deal.price <= 0) return '';
    const title = String(deal.title || '');
    if (/[+＋]|증정|혼합|랜덤|개입|종\b/.test(title)) return '';
    const sizes = [...title.matchAll(/(\d+(?:\.\d+)?)\s*(ml|kg|g|L)\b/gi)];
    const count = title.match(/,\s*(\d+)\s*(개|병|캔|팩|봉|롤)\s*$/);
    if (sizes.length !== 1 || !count || Number(count[1]) <= 1 || Number(count[1]) > 1000) return '';
    const size = sizes[0];
    if (size.index >= count.index || Number(size[1]) <= 0) return '';
    return `${size[1]}${size[2]}당 약 ${Math.round(deal.price / Number(count[1])).toLocaleString('ko-KR')}원`;
  }
  return { unitPrice };
});
