'use strict';

const http = require('node:http');
const { runCanary } = require('./ppomppu-playwright-canary');

const port = Number(process.env.PORT || 10000);
let state = {
  status: 'running',
  result: null,
};

const server = http.createServer((request, response) => {
  response.writeHead(state.status === 'complete' ? 200 : 202, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(state));
});

server.listen(port, '0.0.0.0', async () => {
  console.log(`PPOMPPU_CANARY_SERVICE listening on ${port}`);
  const result = await runCanary({ setProcessExitCode: false });
  state = { status: 'complete', result };
});
