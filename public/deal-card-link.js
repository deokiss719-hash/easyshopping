(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DealCardLink = api;
})(typeof globalThis === 'object' ? globalThis : this, function createDealCardLink() {
  function escapeAttribute(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function renderCardContainer(className, value, content, { rel = 'noopener noreferrer' } = {}) {
    const safeClassName = escapeAttribute(className);
    const url = safeExternalUrl(value);
    if (!url) return `<article class="${safeClassName}" aria-disabled="true">${content}</article>`;
    const safeRel = rel === 'sponsored noopener noreferrer' ? rel : 'noopener noreferrer';
    return `<a class="${safeClassName}" href="${escapeAttribute(url)}" target="_blank" rel="${safeRel}">${content}</a>`;
  }

  return { renderCardContainer };
});
