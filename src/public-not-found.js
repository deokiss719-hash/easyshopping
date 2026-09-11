const NOT_FOUND_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>페이지를 찾을 수 없어요 — 이지핫딜</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="wordmark" href="/" aria-label="이지핫딜 홈">
        <span class="wordmark-symbol">E</span>
        <span class="wordmark-name">이지핫딜</span>
      </a>
    </div>
  </header>
  <main>
    <section class="section deals-section" aria-labelledby="not-found-title">
      <div class="empty-state">
        <div class="empty-illustration" aria-hidden="true">404</div>
        <h1 id="not-found-title">요청하신 페이지를 찾을 수 없어요.</h1>
        <p>주소를 다시 확인하거나 홈에서 핫딜을 둘러보세요.</p>
        <a class="load-more" href="/">홈으로 이동</a>
      </div>
    </section>
  </main>
</body>
</html>`;

function publicNotFound(req, res, next) {
  if (req.method !== 'GET' || /^\/api(?:\/|$)/i.test(req.path)) return next();
  return res.status(404).type('html').send(NOT_FOUND_HTML);
}

module.exports = { NOT_FOUND_HTML, publicNotFound };
