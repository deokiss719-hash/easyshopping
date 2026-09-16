(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  let eligible = false;
  const tracker = api.createTracker({
    pixel: (...args) => root.fbq?.(...args),
    storage: (() => { try { return root.sessionStorage; } catch { return null; } })(),
    location: root.location,
    history: root.history,
    ready: () => eligible && typeof root.fbq?.callMethod === 'function',
  });
  root.fetch('/api/deal-clicks/meta-eligibility', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.ok ? r.json() : null).then(data => { eligible = data?.eligible === true; }).catch(() => {});
  function record(event) {
    if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
    const link = event.target.closest?.('a[data-deal-id]');
    if (link) tracker.track({ id: link.dataset.dealId, href: link.href });
  }
  root.document.addEventListener('click', record);
  root.document.addEventListener('auxclick', record);
})(typeof globalThis === 'object' ? globalThis : this, function() {
  // Only recognized merchant destinations qualify; community and unknown links fail closed.
  function merchantFor(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      const host = url.hostname;
      if ((host === 'toss.im' && url.pathname.startsWith('/_m/')) ||
          (['toss.shopping', 'shopping.toss.im'].includes(host) && /^\/(t|products)\//.test(url.pathname))) return 'toss';
      if (host === 'link.coupang.com' && url.pathname.startsWith('/')) return 'coupang';
      if (['www.coupang.com', 'm.coupang.com'].includes(host) && /\/products\/\d+/.test(url.pathname)) return 'coupang';
      return null;
    } catch { return null; }
  }
  function createTracker({ pixel, storage, location, history, ready = () => true, now = Date.now } = {}) {
    const memory = new Map();
    let testMode = false;
    try {
      const mode = new URL(location.href).searchParams.get('meta_test');
      if (mode === '1') storage?.setItem('ehd_meta_test', '1');
      if (mode === '0') storage?.removeItem('ehd_meta_test');
      testMode = mode === '1' || storage?.getItem('ehd_meta_test') === '1';
    } catch { /* Storage may be blocked. */ }
    function track({ id, href } = {}) {
      const merchant = merchantFor(href);
      if (!merchant || !/^[1-9]\d{0,15}$/.test(String(id || '')) || testMode || !ready() || typeof pixel !== 'function') return false;
      const key = `ehd_merchant:${merchant}:${id}`;
      const at = now();
      let last = memory.get(key);
      try { last = Number(storage?.getItem(key)) || last; } catch {}
      if (last != null && at - last < 30 * 60 * 1000) return false;
      try {
        // No product title, search query, destination query string, price, or fake revenue.
        const originalUrl = location?.href;
        try {
          if (originalUrl && history) {
            const clean = new URL(originalUrl);
            clean.searchParams.delete('q');
            history.replaceState(history.state, '', clean.href);
          }
        pixel('trackSingleCustom', '1175739998075582', 'MerchantOutboundClick', {
          merchant, deal_id: String(id), destination_type: 'merchant',
        });
        } finally {
          if (originalUrl && history) history.replaceState(history.state, '', originalUrl);
        }
        memory.set(key, at);
        try { storage?.setItem(key, String(at)); } catch {}
        return true;
      } catch { return false; }
    }
    return { track };
  }
  return { merchantFor, createTracker };
});
