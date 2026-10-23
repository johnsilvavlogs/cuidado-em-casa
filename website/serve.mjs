import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = await realpath(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 4175);
const host = '127.0.0.1';
const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf' };
createServer(async (req, res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{'Allow':'GET, HEAD'}).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relative.split('/').some(part => part.startsWith('.')) || !['index.html','styles.css','app.js','config.js'].includes(relative) && !relative.startsWith('assets/')) throw new Error('Not public');
    const requested = resolve(root, relative);
    const path = await realpath(requested);
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw new Error('Not public');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Content-Length':body.length, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin', 'Content-Security-Policy':"default-src 'self'; img-src 'self'; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'; object-src 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Não encontrado.'); }
}).listen(port, host, () => console.log(`Cuidado em Casa website: http://${host}:${port}`));
