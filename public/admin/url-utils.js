(function exposeAdminUrlUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AdminUrlUtils = api;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function normalizeHttpsUrlInput(value) {
    const trimmed = String(value || '').trim();
    return trimmed.replace(/^http:\/\//i, 'https://');
  }

  return Object.freeze({ normalizeHttpsUrlInput });
}));
