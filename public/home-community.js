(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('homeCommunityList');
    if (!list) return;
    try {
      const response = await fetch('/api/community/popular', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('community unavailable');
      const data = await response.json();
      const posts = Array.isArray(data.posts) ? data.posts : [];
      list.replaceChildren();
      if (!posts.length) {
        const empty = document.createElement('p');
        empty.textContent = '첫 인기 글을 기다리고 있어요.';
        list.append(empty);
        return;
      }
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
      const empty = document.createElement('p');
      empty.textContent = '커뮤니티 인기 글을 잠시 불러오지 못했어요.';
      list.append(empty);
    }
  });
})();
