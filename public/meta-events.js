(function exposeMetaEvents(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.MetaEvents = api.createMetaEventTracker(root.fbq, {
    location: root.location,
    history: root.history,
    requireLoaded: true,
  });
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  function createMetaEventTracker(pixel, options = {}) {
    let lastSearch = '';
    const location = options.location;
    const history = options.history;
    const requireLoaded = options.requireLoaded === true;

    function resetSearch() {
      lastSearch = '';
    }

    function callWithoutSearchQuery(callback) {
      if (!location || !history || typeof history.replaceState !== 'function') {
        callback();
        return;
      }

      const originalUrl = location.href;
      const cleanUrl = new URL(originalUrl);
      if (!cleanUrl.searchParams.has('q')) {
        callback();
        return;
      }

      cleanUrl.searchParams.delete('q');
      const cleanPath = `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`;
      try {
        history.replaceState(history.state, '', cleanPath);
        callback();
      } finally {
        history.replaceState(history.state, '', originalUrl);
      }
    }

    function trackSearch(value) {
      if (typeof value !== 'string') return false;
      const normalized = value.trim().slice(0, 100);
      if (!normalized) {
        resetSearch();
        return false;
      }
      if (normalized === lastSearch || typeof pixel !== 'function') return false;
      if (requireLoaded && typeof pixel.callMethod !== 'function') return false;

      try {
        callWithoutSearchQuery(() => pixel('track', 'Search'));
        lastSearch = normalized;
        return true;
      } catch {
        return false;
      }
    }

    return { resetSearch, trackSearch };
  }

  return { createMetaEventTracker };
}));
