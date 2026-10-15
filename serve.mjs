/**
 * 极简静态文件服务器（用于本地预览与截图验证）
 * 用法：node serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8848);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';

    const full = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

    const s = await stat(full).catch(() => null);
    if (!s || !s.isFile()) {
      // SPA 回退
      const idx = await readFile(join(ROOT, 'index.html')).catch(() => null);
      if (idx && !extname(p)) {
        res.writeHead(200, { 'content-type': MIME['.html'] }).end(idx);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + p);
      return;
    }

    const buf = await readFile(full);
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(buf);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500 ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`周易站点已启动: http://127.0.0.1:${PORT}/`);
  console.log(`根目录: ${ROOT}`);
});
