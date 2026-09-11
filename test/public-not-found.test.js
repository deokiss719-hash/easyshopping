const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { publicNotFound } = require('../src/public-not-found');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    status(code) { this.statusCode = code; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

test('존재하지 않는 공개 GET은 브랜드 안내와 홈 링크를 담은 HTML 404다', () => {
  const res = responseRecorder();
  publicNotFound({ method: 'GET', path: '/missing' }, res, () => assert.fail('next를 호출하면 안 된다'));

  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['content-type'], 'html');
  assert.match(res.body, /<header class="site-header">/);
  assert.match(res.body, /이지핫딜/);
  assert.match(res.body, /요청하신 페이지를 찾을 수 없어요/);
  assert.match(res.body, /<a[^>]+href="\/"[^>]*>홈으로 이동<\/a>/);
  assert.match(res.body, /href="\/styles\.css"/);
});

test('/api 오류와 GET 이외 요청은 기존 오류 계약을 위해 통과시킨다', () => {
  for (const req of [
    { method: 'GET', path: '/api/missing' },
    { method: 'GET', path: '/API/missing' },
    { method: 'GET', path: '/Api' },
    { method: 'POST', path: '/missing' },
  ]) {
    const res = responseRecorder();
    let nextCalled = false;
    publicNotFound(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, '');
  }
});

test('실제 Express 서버에서도 대문자 API namespace의 미등록 GET은 branded 404로 바뀌지 않는다', async (t) => {
  const app = express();
  app.use(publicNotFound);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/API/missing`);
  const body = await response.text();
  assert.equal(response.status, 404);
  assert.doesNotMatch(body, /이지핫딜|요청하신 페이지를 찾을 수 없어요/);
  assert.match(body, /Cannot GET \/API\/missing/);
});
