(function(root) {
  const sent = new Set();
  function send(link, event) {
    const placement = link?.dataset.kakaoPlacement;
    const key = `${placement}:${event}`;
    if (!['hero', 'middle', 'mobile'].includes(placement) || sent.has(key)) return;
    const body = JSON.stringify({ placement, event });
    try {
      if (!root.navigator.sendBeacon?.('/api/cta-events', new Blob([body], { type: 'application/json' }))) {
        root.fetch('/api/cta-events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin', keepalive: true }).catch(() => {});
      }
      sent.add(key);
    } catch { /* The Kakao link still opens normally. */ }
  }
  root.document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const link = event.target.closest?.('a[data-kakao-placement]');
    if (link) send(link, 'click');
  });
  if ('IntersectionObserver' in root) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) return;
      observer.unobserve(entry.target); send(entry.target, 'impression');
    }), { threshold: 0.5 });
    root.document.querySelectorAll('a[data-kakao-placement]').forEach((link) => observer.observe(link));
  }
})(window);
