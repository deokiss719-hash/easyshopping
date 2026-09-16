(function(root) {
  const clicked = new Set();
  const impressed = new Set();
  function send(link, event) {
    const id = link?.dataset.dealId;
    const section = link?.dataset.section || 'all-deals';
    const position = Number(link?.dataset.position || 1);
    const body = JSON.stringify({ dealId: id, event, section, position });
    if (root.navigator.sendBeacon?.('/api/deal-clicks', new Blob([body], { type: 'application/json' }))) return;
    root.fetch('/api/deal-clicks', { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin', keepalive: true }).catch(() => {});
  }
  function record(event) {
    if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
    const link = event.target.closest?.('a[data-deal-id]');
    const id = link?.dataset.dealId;
    if (!/^[1-9]\d{0,15}$/.test(id || '') || clicked.has(id)) return;
    try {
      send(link, 'click'); clicked.add(id);
    } catch { /* The original link still opens normally. */ }
  }
  root.document.addEventListener('click', record);
  root.document.addEventListener('auxclick', record);
  if ('IntersectionObserver' in root) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      const link = entry.target;
      const key = `${link.dataset.section}:${link.dataset.dealId}`;
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || impressed.has(key)) return;
      impressed.add(key); observer.unobserve(link); send(link, 'impression');
    }), { threshold: 0.5 });
    const watch = () => root.document.querySelectorAll('a[data-deal-id]').forEach((link) => {
      if (link.dataset.impressionObserved) return;
      link.dataset.impressionObserved = '1'; observer.observe(link);
    });
    new MutationObserver(watch).observe(root.document.body, { childList: true, subtree: true });
    watch();
  }
})(window);
