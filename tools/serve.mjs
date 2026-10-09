// Dev server: serves the build and, under /game/, a local copy of the game
// data with a generated manifest.json (never part of any published build).
//   node tools/serve.mjs [webroot=build/web] [port=8082] [gamedir=downloads/demo/HOSP]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'build/web');
const port = +(process.argv[3] || 8082);
const gameDir = path.resolve(process.argv[4] || 'downloads/demo/HOSP');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push({ path: rel, size: fs.statSync(path.join(dir, e.name)).size });
  }
  return out;
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'POST' && url === '/log') {
    let body = ''; req.on('data', (d) => body += d);
    req.on('end', () => { fs.appendFileSync(path.join(root, '..', 'browser.log'), body + '\n'); res.end('ok'); });
    return;
  }
  let file;
  if (url === '/game/manifest.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(walk(gameDir)));
  } else if (url.startsWith('/game/')) {
    file = path.join(gameDir, url.slice(6));
    if (!file.startsWith(gameDir)) { res.writeHead(403); return res.end(); }
  } else {
    file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, () => console.log(`http://localhost:${port}/  (game data: ${gameDir})`));
