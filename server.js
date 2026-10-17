// Uso: node server.js  (Node 18+) e abra http://localhost:8787
// Serve o iptv-web.html e repassa listas/streams com CORS liberado.
// Escuta só em 127.0.0.1, então só o seu computador usa.
const http = require('http'), fs = require('fs'), path = require('path');
const { Readable } = require('stream');
const PORT = 8787;
const P = u => '/p?u=' + encodeURIComponent(u);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (url.pathname !== '/p') { res.statusCode = 404; return res.end(); }

  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-expose-headers', '*');
  res.setHeader('x-iptv-proxy', '1');

  const u = url.searchParams.get('u');
  if (!u) return res.end('ok'); // ping: o app usa para detectar o proxy
  if (!/^https?:\/\//i.test(u)) { res.statusCode = 400; return res.end(); }

  const ac = new AbortController();
  res.on('close', () => ac.abort()); // trocou de canal: encerra a conexão com o servidor

  try {
    const headers = { 'user-agent': req.headers['user-agent'] || 'Mozilla/5.0' };
    if (req.headers.range) headers.range = req.headers.range;
    const r = await fetch(u, { headers, signal: ac.signal, redirect: 'follow' });
    res.statusCode = r.status;
    const ct = r.headers.get('content-type') || '';

    // Manifestos HLS: reescreve os links internos para passarem pelo proxy também
    if (/mpegurl/i.test(ct) || /\.m3u8(\?|$)/i.test(u)) {
      const base = r.url;
      let txt = await r.text();
      if (txt.includes('#EXT-X-')) {
        txt = txt.split('\n').map(l => {
          const t = l.trim();
          if (!t) return l;
          if (t[0] !== '#') return P(new URL(t, base).href);
          return l.replace(/URI="([^"]+)"/g, (m, x) => `URI="${P(new URL(x, base).href)}"`);
        }).join('\n');
      }
      res.setHeader('content-type', ct || 'application/vnd.apple.mpegurl');
      return res.end(txt);
    }

    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const val = r.headers.get(k);
      if (val) res.setHeader(k, val);
    }
    Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.statusCode = 502;
    res.end(String(e.message));
  }
}).listen(PORT, '127.0.0.1', () => console.log('Abra http://localhost:' + PORT));
