// Uso: node server.js  (Node 18+) e abra http://localhost:8787
// Serve o index.html e repassa listas/streams com CORS liberado.
// Escuta só em 127.0.0.1, então só o seu computador usa.
const http = require('http'), fs = require('fs'), path = require('path');
const { Readable } = require('stream');
const { spawn, spawnSync } = require('child_process');
const FF = spawnSync('ffmpeg', ['-version']).status === 0; // ffmpeg instalado?
const PORT = 8787;
const P = u => '/p?u=' + encodeURIComponent(u);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  // Filmes/séries em mkv, avi etc.: converte na hora para MP4 (vídeo copiado, áudio em AAC).
  // ?enc=1 recodifica o vídeo em H.264 (mais pesado, resolve HEVC). Sem seek na conversão.
  if (url.pathname === '/t') {
    const u = url.searchParams.get('u');
    if (!FF) { res.statusCode = 501; return res.end('ffmpeg não encontrado'); }
    if (!u || !/^https?:\/\//i.test(u)) { res.statusCode = 400; return res.end(); }
    const vc = url.searchParams.get('enc')
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'copy'];
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', u,
      '-map', '0:v:0', '-map', '0:a:0?', ...vc, '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1']);
    res.setHeader('content-type', 'video/mp4');
    ff.stdout.pipe(res);
    ff.on('error', () => res.end());
    res.on('close', () => ff.kill('SIGKILL')); // trocou de canal: mata o ffmpeg
    return;
  }
  if (url.pathname !== '/p') { res.statusCode = 404; return res.end(); }

  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-expose-headers', '*');
  res.setHeader('x-iptv-proxy', '1');
  res.setHeader('x-iptv-ffmpeg', FF ? '1' : '0');

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
