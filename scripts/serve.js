// Minimal static server for running the checker locally: serves web/ at the
// root and the marketplace rule files at /profiles/. There is no backend here —
// the hosted site's anonymous usage ping and waitlist form simply fail
// locally, and the checker keeps working without them.
//
// Usage: node scripts/serve.js   (then open http://localhost:3000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.join(ROOT, 'web');
const PROFILES_ROOT = path.join(ROOT, 'profiles');
const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const isProfile = urlPath.startsWith('/profiles/');
    const root = isProfile ? PROFILES_ROOT : WEB_ROOT;
    const relative = isProfile ? urlPath.slice('/profiles/'.length) : urlPath === '/' ? 'index.html' : urlPath;
    const resolved = path.normalize(path.join(root, relative));

    if (req.method !== 'GET' || !resolved.startsWith(root + path.sep)) {
      res.writeHead(404).end('Not found');
      return;
    }
    fs.readFile(resolved, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(resolved)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`ModelReady checker running at http://localhost:${PORT}`));
