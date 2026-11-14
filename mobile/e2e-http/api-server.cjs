/* global __dirname */
// Test-only supervisor, never imported by the API or shipped in app bundles. It empties and seeds the test database,
// runs the API on port 3100, and on 3101 serves the latest emailed code per address (read from the
// API's console email provider) plus POST /restart.
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const cwd = path.resolve(__dirname, '../../api');
if (new URL(process.env.DATABASE_URL).pathname !== '/smart_mailroom_test')
  throw Error('Browser harness requires the isolated test database.');
const env = {
  ...process.env,
  PORT: '3100',
  HOST: '127.0.0.1',
  CORS_ORIGINS: 'http://127.0.0.1:8082,http://localhost:8082',
};
const codes = new Map();
let output = '';
let child;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    output = (output + chunk).slice(-4096);
    for (const [, email, code] of output.matchAll(/\[email to (\S+)\][^\n]*\nYour code is (\d{6})/g))
      codes.set(email, code);
  });
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch('http://127.0.0.1:3100/readyz')).ok) return;
    } catch {
      /* starting */
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('API process failed to start.');
}
async function stop() {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
}
const run = script =>
  new Promise((resolve, reject) =>
    spawn(process.execPath, ['--import', 'tsx', script], { cwd, env, windowsHide: true, stdio: 'ignore' }).on(
      'exit',
      code => (code ? reject(Error(`${script} failed.`)) : resolve()),
    ),
  );
void (async () => {
  await run('tests/reset-http.ts');
  await run('src/seed.ts');
  await start();
  http
    .createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/restart') {
        await stop();
        await start();
      }
      if (url.pathname === '/code') {
        response.writeHead(codes.has(url.searchParams.get('email')) ? 200 : 404);
        return response.end(codes.get(url.searchParams.get('email')) ?? '');
      }
      response.writeHead(200);
      response.end('Test supervisor ready');
    })
    .listen(3101, '127.0.0.1');
})();
process.on('SIGINT', () => {
  void stop().then(() => process.exit());
});
process.on('SIGTERM', () => {
  void stop().then(() => process.exit());
});
process.on('exit', () => child?.kill());
