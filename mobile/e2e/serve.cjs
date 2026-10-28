/* global __dirname */
// Minimal local SPA server for testing the actual production web export.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Run npm run export:web first.');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400); res.end(); return; }
  const target = path.resolve(root, '.' + pathname);
  if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(8081, '127.0.0.1', () => console.log('Production export ready at http://127.0.0.1:8081'));
