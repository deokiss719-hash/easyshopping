(function(root) {
  const sent = new Set();
  function record(event) {
    if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1)) return;
    const link = event.target.closest?.('a[data-deal-id]');
    const id = link?.dataset.dealId;
    if (!/^[1-9]\d{0,15}$/.test(id || '') || sent.has(id)) return;
    const body = JSON.stringify({ dealId: id });
    try {
      if (root.navigator.sendBeacon?.('/api/deal-clicks', new Blob([body], { type: 'application/json' }))) { sent.add(id); return; }
      root.fetch('/api/deal-clicks', { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin', keepalive: true }).catch(() => {});
      sent.add(id);
    } catch { /* The original link still opens normally. */ }
  }
  root.document.addEventListener('click', record);
  root.document.addEventListener('auxclick', record);
})(window);
