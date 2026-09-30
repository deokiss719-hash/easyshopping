(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  if (!['/', '/index.html'].includes(root.location.pathname)) return;
  let eligible = false;
  const tracker = api.createTracker({
    pixel: (...args) => root.fbq?.(...args),
    storage: (() => { try { return root.sessionStorage; } catch { return null; } })(),
    location: root.location, history: root.history,
    ready: () => eligible && typeof root.fbq?.callMethod === 'function',
  });
  root.fetch('/api/deal-clicks/meta-eligibility', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.ok ? r.json() : null).then(data => { eligible = data?.eligible === true; }).catch(() => {});
  function record(event) {
    if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
    const link = event.target.closest?.('a[href]');
    if (link) tracker.track(link.href);
  }
  root.document.addEventListener('click', record);
  root.document.addEventListener('auxclick', record);
})(typeof globalThis === 'object' ? globalThis : this, function() {
  function destination(href, origin) {
    try {
      const url = new URL(href, origin);
      if (url.origin !== origin || url.username || url.password) return null;
      if (/^\/community(?:\/posts\/\d+)?\/?$/.test(url.pathname)) return 'community';
      if (url.pathname === '/phone.html') return 'phone';
      if (/^\/saju\/?$/.test(url.pathname) && !url.search && !url.hash) return 'saju';
      return null;
    } catch { return null; }
  }
  function createTracker({ pixel, storage, location, history, ready = () => true, now = Date.now } = {}) {
    const memory = new Map();
    function track(href) {
      const original = location?.href;
      let url;
      try { url = new URL(original); } catch { return false; }
      if (!['/', '/index.html'].includes(url.pathname)) return false;
      const service = destination(href, url.origin);
      if (!service || !ready() || typeof pixel !== 'function') return false;
      try {
        if (url.searchParams.get('meta_test') === '1' || storage?.getItem('ehd_meta_test') === '1') return false;
      } catch { return false; }
      const key = `ehd_service:${service}`;
      let last = memory.get(key);
      try { const saved = storage?.getItem(key); if (saved != null) last = Number(saved); } catch {}
      const at = now();
      if (last != null && at - last < 30 * 60 * 1000) return false;
      try {
        // Only a fixed service label is sent: no inquiry, search, birth or report data.
        if (!history?.replaceState) return false;
        history.replaceState(history.state, '', `${url.origin}/`);
        pixel('trackSingleCustom', '1175739998075582', 'HomeServiceClick', { service, source: 'homepage' });
        memory.set(key, at);
        try { storage?.setItem(key, String(at)); } catch {}
        return true;
      } catch { return false; }
      finally { if (history?.replaceState) history.replaceState(history.state, '', original); }
    }
    return { track };
  }
  return { destination, createTracker };
});
