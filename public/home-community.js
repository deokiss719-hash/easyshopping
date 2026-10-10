(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('homeCommunityList');
    if (!list) return;
    const section = list.closest('.home-community');
    if (section) section.hidden = true;
    try {
      const response = await fetch('/api/community/popular', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('community unavailable');
      const data = await response.json();
      const posts = Array.isArray(data.posts) ? data.posts : [];
      list.replaceChildren();
      if (!posts.length) return;
      if (section) section.hidden = false;
      posts.forEach((post) => {
        const row = document.createElement('div');
        row.className = 'home-community-row';
        const category = document.createElement('span');
        category.textContent = post.categoryName;
        const link = document.createElement('a');
        link.href = `/community/posts/${encodeURIComponent(post.id)}`;
        link.textContent = `${post.answered ? '✓ ' : ''}${post.title}${post.commentCount ? ` [${post.commentCount}]` : ''}`;
        const meta = document.createElement('small');
        meta.textContent = `추천 ${Number(post.upvotes || 0)} · 조회 ${Number(post.views || 0)}`;
        row.append(category, link, meta);
        list.append(row);
      });
    } catch {
      list.replaceChildren();
      if (section) section.hidden = true;
    }
  });
})();
