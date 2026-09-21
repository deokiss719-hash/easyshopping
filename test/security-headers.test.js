const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { securityHeaders } = require('../src/security-headers');

test('public responses include browser security headers', async (t) => {
  const app = express();
  app.use(securityHeaders);
  app.get('/', (_request, response) => response.send('ok'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
});
