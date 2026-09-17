const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');

const { migrate } = require('../src/deal-store');
const { createCommunityStore, detailHtml } = require('../src/community/community');

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

test('one-level replies work and a second-level reply is rejected', async () => {
  const { pool, store } = await makeStore();
  const category = await freeCategory(store);
  const created = await store.createPost({ categoryId: category.id, title: '답글 테스트', body: '본문' }, 'a'.repeat(64));
  const first = await store.createComment(created.post.id, { body: '첫 댓글' }, 'b'.repeat(64));
  const reply = await store.createComment(created.post.id, { body: '답글', parentCommentId: first.id }, 'c'.repeat(64));
  assert.equal(reply.parentCommentId, first.id);
  await assert.rejects(() => store.createComment(created.post.id, { body: '2단계', parentCommentId: reply.id }, 'd'.repeat(64)), /한 단계/);
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
  assert.match(detailHtml(created.post), /&lt;script&gt;/);
  assert.equal((await store.sitemapPosts()).length, 1);
  await store.adminModeratePost(created.post.id, { action: 'hide' });
  assert.equal(await store.getPost(created.post.id, null), null);
  assert.equal((await store.sitemapPosts()).length, 0);
  await pool.end();
});
