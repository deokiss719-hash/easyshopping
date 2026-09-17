const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');

const { migrate } = require('../src/deal-store');
const { createCommunityStore, detailHtml, maskIp } = require('../src/community/community');

async function makeStore() {
  const memoryDb = newDb();
  const { Pool } = memoryDb.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  return { pool, store: createCommunityStore(pool) };
}

async function freeCategory(store) {
  return (await store.categories()).find((category) => category.slug === 'free');
}

test('community migration is idempotent and exposes the initial categories', async () => {
  const { pool, store } = await makeStore();
  await migrate(pool);
  assert.deepEqual((await store.categories()).map((item) => item.slug), ['free']);
  await pool.end();
});

test('anonymous author can create/read a post without exposing author hash publicly', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '아이폰 질문', body: '지금 사도 될까요?', nickname: 'ㅇㅇ' }, 'a'.repeat(64));
  assert.equal(created.post.isAuthor, true);
  assert.equal(created.post.authorHash, undefined);
  const listed = await store.listPosts({}, 'b'.repeat(64));
  assert.equal(listed.total, 1);
  assert.equal(listed.posts[0].isAuthor, false);
  assert.equal(listed.posts[0].authorHash, undefined);
  await pool.end();
});


test('admin notices are identified, private from IP display, and pinned above normal posts', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  await store.createPost({ categoryId: category.id, title: '일반 글', body: '일반 본문' }, 'a'.repeat(64), '123.45.*.*');
  const notice = await store.adminCreateNotice({ title: '운영 공지', body: '공지 본문' });
  assert.equal(notice.post.isNotice, true);
  assert.equal(notice.post.isPinned, true);
  assert.equal(notice.post.nickname, '이지핫딜 관리자');
  assert.equal(notice.post.ipDisplay, '');
  const latest = await store.listPosts({ sort: 'latest' });
  assert.equal(latest.posts[0].title, '운영 공지');
  assert.equal(latest.posts[0].isNotice, true);
  const popular = await store.listPosts({ sort: 'popular' });
  assert.equal(popular.posts[0].title, '운영 공지');
  await store.adminModeratePost(notice.post.id, { action: 'unpin' });
  assert.equal((await store.getPost(notice.post.id, null)).post.isPinned, true);
  await store.adminModeratePost(notice.post.id, { action: 'delete' });
  assert.equal(await store.getPost(notice.post.id, null), null);
  assert.equal((await store.listPosts({ sort: 'latest' })).posts.some((post) => post.id === notice.post.id), false);
  await pool.end();
});

test('admin can pin and unpin a normal post at the top', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const older = await store.createPost({ categoryId: category.id, title: '고정할 글', body: '본문' }, 'a'.repeat(64));
  const newer = await store.createPost({ categoryId: category.id, title: '새 글', body: '본문' }, 'b'.repeat(64));
  assert.equal((await store.listPosts({ sort: 'latest' })).posts[0].id, newer.post.id);
  await store.adminModeratePost(older.post.id, { action: 'pin' });
  const pinned = await store.listPosts({ sort: 'latest' });
  assert.equal(pinned.posts[0].id, older.post.id);
  assert.equal(pinned.posts[0].isPinned, true);
  const adminRows = await store.adminListPosts();
  assert.equal(adminRows.posts[0].id, older.post.id);
  await store.adminModeratePost(older.post.id, { action: 'unpin' });
  const unpinned = await store.listPosts({ sort: 'latest' });
  assert.equal(unpinned.posts[0].id, newer.post.id);
  assert.equal(unpinned.posts.find((post) => post.id === older.post.id).isPinned, false);
  await pool.end();
});

test('admin post list separates deleted posts from active posts', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const active = await store.createPost({ categoryId: category.id, title: '활성 글', body: '본문' }, 'a'.repeat(64));
  const deleted = await store.createPost({ categoryId: category.id, title: '삭제 보관 글', body: '본문' }, 'b'.repeat(64));
  await store.adminModeratePost(deleted.post.id, { action: 'delete' });
  const activeRows = await store.adminListPosts();
  const deletedRows = await store.adminListPosts({ deleted: 'only' });
  assert.deepEqual(activeRows.posts.map((post) => post.id), [active.post.id]);
  assert.deepEqual(deletedRows.posts.map((post) => post.id), [deleted.post.id]);
  await store.adminModeratePost(deleted.post.id, { action: 'restore' });
  assert.equal((await store.adminListPosts({ deleted: 'only' })).total, 0);
  assert.equal((await store.adminListPosts()).total, 2);
  await pool.end();
});

test('community stores only masked IP display values for public posts and comments', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '아이피 표시', body: '본문', nickname: 'ㅇㅇ' }, 'a'.repeat(64), '123.45.*.*');
  assert.equal(created.post.ipDisplay, '123.45.*.*');
  const comment = await store.createComment(created.post.id, { body: '댓글', nickname: '댓글러' }, 'b'.repeat(64), { ipDisplay: '211.22.*.*' });
  assert.equal(comment.ipDisplay, '211.22.*.*');
  await store.adminReply(created.post.id, { body: '관리자 댓글' });
  const detail = await store.getPost(created.post.id, 'a'.repeat(64));
  assert.equal(detail.comments[1].ipDisplay, '');
  await pool.end();
});

test('IP masking keeps only a partial display value', () => {
  assert.equal(maskIp('123.45.67.89'), '123.45.*.*');
  assert.equal(maskIp('::ffff:211.22.33.44'), '211.22.*.*');
  assert.equal(maskIp('2001:db8:abcd:1234::1'), '2001:db8:*:*');
  assert.equal(maskIp('999.1.2.3'), '');
});

test('phone or email-like personal data requires an explicit privacy confirmation', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  await assert.rejects(
    () => store.createPost({ categoryId: category.id, title: '연락 주세요', body: '010-1234-5678 입니다' }, 'a'.repeat(64)),
    (error) => error.code === 'privacy_warning',
  );
  const created = await store.createPost({ categoryId: category.id, title: '연락 주세요', body: 'test@example.com 입니다', confirmPrivacy: true }, 'a'.repeat(64));
  assert.equal(created.post.title, '연락 주세요');
  await pool.end();
});

test('cookie identity or bcrypt deletion password can authorize post deletion', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '삭제 테스트', body: '본문', password: 'safe1234' }, 'a'.repeat(64));
  await assert.rejects(() => store.deletePost(created.post.id, 'b'.repeat(64), 'wrong'), /forbidden/);
  assert.equal(await store.deletePost(created.post.id, 'b'.repeat(64), 'safe1234'), true);
  assert.equal(await store.getPost(created.post.id, 'a'.repeat(64)), null);
  await pool.end();
});

test('nested replies can continue beyond one level', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '답글 테스트', body: '본문' }, 'a'.repeat(64));
  const first = await store.createComment(created.post.id, { body: '첫 댓글' }, 'b'.repeat(64));
  const reply = await store.createComment(created.post.id, { body: '답글', parentCommentId: first.id }, 'c'.repeat(64));
  const nested = await store.createComment(created.post.id, { body: '2단계 답글', parentCommentId: reply.id }, 'd'.repeat(64));
  const deeper = await store.createComment(created.post.id, { body: '3단계 답글', parentCommentId: nested.id }, 'e'.repeat(64));
  assert.equal(reply.parentCommentId, first.id);
  assert.equal(nested.parentCommentId, reply.id);
  assert.equal(deeper.parentCommentId, nested.id);
  await pool.end();
});

test('votes are unique per anonymous identity and switching direction adjusts totals', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '투표 테스트', body: '본문' }, 'a'.repeat(64));
  const first = await store.vote('post', created.post.id, 'b'.repeat(64), 1);
  assert.deepEqual(first, { upvotes: 1, downvotes: 0, value: 1 });
  const duplicate = await store.vote('post', created.post.id, 'b'.repeat(64), 1);
  assert.deepEqual(duplicate, { upvotes: 1, downvotes: 0, value: 1 });
  const switched = await store.vote('post', created.post.id, 'b'.repeat(64), -1);
  assert.deepEqual(switched, { upvotes: 0, downvotes: 1, value: -1 });
  await pool.end();
});

test('post views are deduplicated per anonymous identity', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '조회 테스트', body: '본문' }, 'a'.repeat(64));
  await store.getPost(created.post.id, 'b'.repeat(64), true);
  await store.getPost(created.post.id, 'b'.repeat(64), true);
  await store.getPost(created.post.id, 'c'.repeat(64), true);
  assert.equal((await store.getPost(created.post.id, 'a'.repeat(64))).post.views, 2);
  await pool.end();
});

test('admin reply is stored as a clearly identified admin comment', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '관리자 답변', body: '본문', answerRequested: true }, 'a'.repeat(64));
  await store.adminReply(created.post.id, { body: '이지폰 답변입니다.' });
  const detail = await store.getPost(created.post.id, 'a'.repeat(64));
  assert.equal(detail.post.answered, true);
  assert.equal(detail.comments[0].isAdmin, true);
  assert.equal(detail.comments[0].nickname, '이지핫딜 관리자');
  assert.equal(detail.comments[0].isAuthor, false);
  await pool.end();
});

test('banned words, reports, blocks, and community settings are manageable', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  await store.adminAddBannedWord('금칙테스트');
  await assert.rejects(() => store.createPost({ categoryId: category.id, title: '금칙테스트', body: '본문' }, 'a'.repeat(64)), /사용할 수 없는 표현/);
  const created = await store.createPost({ categoryId: category.id, title: '정상 글', body: '본문' }, 'b'.repeat(64));
  assert.deepEqual(await store.report('post', created.post.id, 'c'.repeat(64), '스팸 같아요'), { ok: true });
  assert.equal((await store.adminReports()).length, 1);
  await store.adminBlock({ authorHash: 'b'.repeat(64), reason: '도배' });
  await assert.rejects(() => store.createComment(created.post.id, { body: '차단 후 댓글' }, 'b'.repeat(64)), /blocked/);
  const settings = await store.adminSaveSettings({ consultation_url: 'https://open.kakao.com/example', rank_upvote_weight: '9' });
  assert.equal(settings.consultation_url, 'https://open.kakao.com/example');
  assert.equal(settings.rank_upvote_weight, '9');
  await pool.end();
});

test('hidden or deleted posts disappear from public reads and sitemap candidates', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: 'SEO 테스트', body: '<script>alert(1)</script>' }, 'a'.repeat(64));
  const html = detailHtml(created.post);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="\/community" class="community-brand">EASY HOT DEAL<\/a>/);
  assert.doesNotMatch(html, /<a href="\/" class="community-brand">EASY HOT DEAL<\/a>/);
  assert.equal((await store.sitemapPosts()).length, 1);
  await store.adminModeratePost(created.post.id, { action: 'hide' });
  assert.equal(await store.getPost(created.post.id, null), null);
  assert.equal((await store.sitemapPosts()).length, 0);
  await pool.end();
});
