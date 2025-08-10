// server.js — Express HLS proxy with manifest URL rewriting (Railway-ready)
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();

// CORS permissivo
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));
app.options('*', cors());

// Health endpoints
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Helpers
function toAbsolute(baseUrl, maybeRelative) {
  try {
    // absolute? return as-is
    const u = new URL(maybeRelative);
    return u.href;
  } catch {
    // relative -> resolve against base
    const base = new URL(baseUrl);
    // If relative starts with '/', it's root-relative
    if (maybeRelative.startsWith('/')) {
      return base.origin + maybeRelative;
    }
    // Else relative to base pathname
    const pathname = base.pathname.endsWith('/') ? base.pathname : base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    return base.origin + pathname + maybeRelative;
  }
}

function rewriteManifest(originalUrl, body, proxyBase) {
  // For each non-comment line (not starting with '#'), rewrite to proxy URL
  const lines = body.split(/\r?\n/);
  const out = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line; // keep comments/tags
    const absolute = toAbsolute(originalUrl, trimmed);
    const proxied = `${proxyBase}/proxy?url=${encodeURIComponent(absolute)}`;
    return proxied;
  });
  return out.join('\n');
}

// Proxy endpoint with manifest rewriting
app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');

  let origin;
  try { origin = new URL(targetUrl).origin; }
  catch { return res.status(400).send('bad url'); }

  const proxyBase = `${req.protocol}://${req.get('host')}`; // our public base

  return createProxyMiddleware({
    target: origin,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true, // we may rewrite the body
    pathRewrite: (_path, req2) => {
      const u = new URL(targetUrl);
      // preserve original path+query exactly
      return u.pathname + (u.search || '');
    },
    onProxyRes: async (proxyRes, req2, res2) => {
      try {
        // Collect response body
        const chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
          const isManifest = ct.includes('application/vnd.apple.mpegurl')
                          || ct.includes('application/x-mpegurl')
                          || req.query.url.toLowerCase().includes('.m3u8');

          // Copy headers
          Object.keys(proxyRes.headers).forEach(h => {
            if (h.toLowerCase() === 'content-length') return; // we'll recalc
            res2.setHeader(h, proxyRes.headers[h]);
          });
          // CORS headers
          res2.setHeader('Access-Control-Allow-Origin', '*');
          res2.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
          res2.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');

          if (isManifest) {
            // Rewrite .m3u8 so that every URI points back to our proxy
            const originalText = buffer.toString('utf8');
            const rewritten = rewriteManifest(req.query.url, originalText, proxyBase);
            const outBuf = Buffer.from(rewritten, 'utf8');
            res2.setHeader('content-type', 'application/vnd.apple.mpegurl');
            res2.setHeader('content-length', outBuf.length);
            return res2.status(proxyRes.statusCode || 200).end(outBuf);
          } else {
            // Pass through (segments .ts, .m4s, etc.)
            res2.status(proxyRes.statusCode || 200);
            return res2.end(buffer);
          }
        });
      } catch (e) {
        console.error('onProxyRes error:', e);
        res2.status(502).send('proxy error');
      }
    },
    headers: req.headers.referer ? { Referer: req.headers.referer, Origin: req.headers.origin || '*' } : undefined,
    logLevel: 'warn',
  })(req, res, next);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Proxy listening on', PORT);
});
