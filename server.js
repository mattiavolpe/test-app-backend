
// server.js — Proxy with HLS manifest rewriting + HTTPS awareness + iframe fetcher
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.set('trust proxy', true);

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));
app.options('*', cors());

app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Helpers for HLS
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

// HLS proxy with manifest rewriting
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

          // Copy headers except content-length
          Object.keys(proxyRes.headers).forEach(h => {
            if (h.toLowerCase() !== 'content-length') res2.setHeader(h, proxyRes.headers[h]);
          });
          // CORS
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

// Iframe fetcher: fetch HTML and strip XFO/CSP; inject <base> for relative URLs
app.get('/iframe', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');

  try {
    const r = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();

    // Inject <base> into <head> and remove X-Frame-Options/CSP by not forwarding them
    const u = new URL(targetUrl);
    let patched = html;

    // naive <head> injection
    if (/<head[^>]*>/i.test(patched)) {
      patched = patched.replace(/<head[^>]*>/i, match => `${match}\n<base href="${u.origin}/">`);
    } else {
      patched = `<head><base href="${u.origin}/"></head>${patched}`;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    // No X-Frame-Options / CSP headers set here
    res.status(200).send(patched);
  } catch (e) {
    console.error('iframe fetch error:', e);
    res.status(502).send('iframe proxy error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Proxy listening on', PORT));
