/* global __dirname */
// Test-only supervisor, never imported by the API or shipped in app bundles.
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const cwd = path.resolve(__dirname, '../../api');
if (new URL(process.env.DATABASE_URL).pathname !== '/smart_mailroom_test') throw Error('Browser harness requires the isolated test database.');
const env = { ...process.env, PORT: '3100', HOST: '127.0.0.1', CORS_ORIGINS: 'http://127.0.0.1:8082,http://localhost:8082' };
let child;
async function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd, env, windowsHide: true, stdio: 'inherit' });
  for (let n = 0; n < 100; n++) { try { if ((await fetch('http://127.0.0.1:3100/v1/session')).status === 401) return; } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('API process failed to start.');
}
async function stop() { if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } }
const seed = spawn(process.execPath, ['--import', 'tsx', 'src/seed.ts'], { cwd, env, windowsHide: true, stdio: 'ignore' });
seed.on('exit', async code => {
  if (code) throw Error('Test seed failed.'); await start();
  http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/restart') { await stop(); await start(); }
    response.writeHead(200); response.end('Test supervisor ready');
  }).listen(3101, '127.0.0.1');
});
process.on('SIGINT', () => { void stop().then(() => process.exit()); });
process.on('SIGTERM', () => { void stop().then(() => process.exit()); });
process.on('exit', () => child?.kill());
