import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const headers = { 'Cache-Control': 'no-cache' };
    if (process.env.SF_HEADERS === '1') {
      const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
      for (const rule of config.headers || []) if (new RegExp('^' + rule.source + '$').test(pathname)) {
        for (const header of rule.headers) headers[header.key] = header.value;
      }
    }
    const p = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (p !== root && !p.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const file = (await stat(p)).isDirectory() ? path.join(p, 'index.html') : p;
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', ...headers });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.PORT || 8000), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
