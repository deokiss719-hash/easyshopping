'use strict';
// Animate only presentation. The full, saved sentence remains available to assistive technology.
window.startSajuReadingMotion = function (root, button) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches || !window.IntersectionObserver) {
    button.hidden = true;
    return () => {};
  }
  button.hidden = false;
  button.disabled = false;
  button.textContent = '기다리지 않고 전체 읽기';
  const states = [];
  let frame = 0, active = null, stopped = false;
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  root.querySelectorAll('article > p:not(.period-tags)').forEach(p => {
    const original = p.textContent;
    const accessible = document.createElement('span');
    accessible.className = 'reading-accessible';
    accessible.textContent = original;
    const visual = document.createElement('span');
    visual.setAttribute('aria-hidden', 'true');
    const letters = segmenter ? [...segmenter.segment(original)].map(x => x.segment) : Array.from(original);
    const chars = letters.map(letter => {
      const span = document.createElement('span');
      span.className = 'reading-letter'; span.textContent = letter;
      visual.append(span); return span;
    });
    p.replaceChildren(accessible, visual);
    states.push({ p, original, chars, visible: false, started: false, done: false, count: 0, since: 0 });
  });
  function finish(s) {
    s.done = true; s.p.textContent = s.original;
    observer.unobserve(s.p);
    if (active === s) active = null;
  }
  function tick(now) {
    frame = 0;
    if (stopped) return;
    if (!active) {
      active = states.find(s => s.visible && !s.done);
      if (active) { active.started = true; active.since = now; }
    }
    if (!active) return;
    const s = active, count = Math.min(s.chars.length, 1 + Math.floor((now - s.since) / 24));
    while (s.count < count) s.chars[s.count++].classList.add('is-written');
    if (count === s.chars.length) finish(s);
    frame = requestAnimationFrame(tick);
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const s = states.find(s => s.p === entry.target);
      s.visible = entry.isIntersecting;
      // Fast scrolling never leaves an already-started sentence half written.
      if (!s.visible && s.started && !s.done) finish(s);
    }
    if (!frame && !stopped) frame = requestAnimationFrame(tick);
  }, { threshold: 0.05 });
  states.forEach(s => observer.observe(s.p));
  function stop() {
    stopped = true; cancelAnimationFrame(frame); observer.disconnect();
    states.filter(s => !s.done).forEach(finish);
    button.textContent = '전체 풀이가 표시됐어요'; button.disabled = true;
    preference.removeEventListener('change', reduce);
    button.onclick = null;
  }
  function reduce(e) { if (e.matches) stop(); }
  preference.addEventListener('change', reduce);
  button.onclick = stop;
  return stop;
};
