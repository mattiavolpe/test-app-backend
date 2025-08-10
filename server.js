
// server.js — Proxy with HLS rewrite + HTTPS + iframe fetch + generic gethls extractor
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.set('trust proxy', true);

app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));
app.options('*', cors());

app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Helpers
function toAbsolute(baseUrl, maybeRelative) {
  try { return new URL(maybeRelative).href; }
  catch {
    const base = new URL(baseUrl);
    if (maybeRelative.startsWith('/')) return base.origin + maybeRelative;
    const pathname = base.pathname.endsWith('/') ? base.pathname : base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    return base.origin + pathname + maybeRelative;
  }
}
function rewriteManifest(originalUrl, body, proxyBase) {
  const lines = body.split(/\r?\n/);
  const out = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const absolute = toAbsolute(originalUrl, trimmed);
    const proxied = `${proxyBase}/proxy?url=${encodeURIComponent(absolute)}`;
    return proxied;
  });
  return out.join('\n');
}

// /proxy — HLS with manifest rewriting
app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');

  let origin;
  try { origin = new URL(targetUrl).origin; }
  catch { return res.status(400).send('bad url'); }

  const proxyBase = `${req.protocol}://${req.get('host')}`;

  return createProxyMiddleware({
    target: origin,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true,
    pathRewrite: (_path, _req2) => {
      const u = new URL(targetUrl);
      return u.pathname + (u.search || '');
    },
    onProxyRes: async (proxyRes, req2, res2) => {
      try {
        const chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
          const isManifest = ct.includes('application/vnd.apple.mpegurl')
                          || ct.includes('application/x-mpegurl')
                          || (req.query.url || '').toLowerCase().includes('.m3u8');

          Object.keys(proxyRes.headers).forEach(h => {
            if (h.toLowerCase() !== 'content-length') res2.setHeader(h, proxyRes.headers[h]);
          });
          res2.setHeader('Access-Control-Allow-Origin', '*');
          res2.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
          res2.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');

          if (isManifest) {
            const originalText = buffer.toString('utf8');
            const rewritten = rewriteManifest(req.query.url, originalText, proxyBase);
            const outBuf = Buffer.from(rewritten, 'utf8');
            res2.setHeader('content-type', 'application/vnd.apple.mpegurl');
            res2.setHeader('content-length', outBuf.length);
            return res2.status(proxyRes.statusCode || 200).end(outBuf);
          } else {
            res2.status(proxyRes.statusCode || 200);
            return res2.end(buffer);
          }
        });
      } catch (e) {
        console.error('onProxyRes error:', e);
        res2.status(502).send('proxy error');
      }
    },
    headers: { Referer: origin, Origin: origin },
    logLevel: 'warn',
  })(req, res, next);
});

// /iframe — best-effort HTML proxy
app.get('/iframe', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');

  try {
    const r = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const u = new URL(targetUrl);
    let patched = html;
    if (/<head[^>]*>/i.test(patched)) {
      patched = patched.replace(/<head[^>]*>/i, match => `${match}\n<base href="${u.origin}/">`);
    } else {
      patched = `<head><base href="${u.origin}/"></head>${patched}`;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(patched);
  } catch (e) {
    console.error('iframe fetch error:', e);
    res.status(502).send('iframe proxy error');
  }
});

// /gethls — extract first .m3u8 from any page (Skyline, Webcamtaxi, etc.)
app.get('/gethls', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'missing url' });
  try {
    const r = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();

    // simple regexes to find .m3u8 in HTML/JS
    const patterns = [
      /https?:\/\/[^\s'"]+\.m3u8[^\s'"]*/gi,
      /['"]([^'"]+\.m3u8[^'"]*)['"]/gi
    ];
    let found = null;
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m.length) { found = m[0].replace(/^['"]|['"]$/g, ''); break; }
    }

    // also try to capture relative URLs in <source> or JS arrays
    if (!found) {
      const relPattern = /(?:src|file)\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/gi;
      const m = relPattern.exec(html);
      if (m && m[1]) { found = m[1]; }
    }

    if (!found) return res.status(404).json({ error: 'no m3u8 found' });

    // normalize to absolute
    let abs = found;
    try { new URL(abs); } catch {
      const base = new URL(targetUrl);
      if (abs.startsWith('/')) abs = base.origin + abs;
      else {
        const pathname = base.pathname.endsWith('/') ? base.pathname : base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
        abs = base.origin + pathname + abs;
      }
    }

    return res.json({ url: abs });
  } catch (e) {
    console.error('gethls error:', e);
    res.status(502).json({ error: 'gethls error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Proxy listening on', PORT));
