// server.js — Minimal Express proxy for Railway (fixed)
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Root + health for Railway health checks
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Usage: GET /proxy?url=<encoded target URL>
app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');

  let u;
  try { u = new URL(targetUrl); } catch (_e) { return res.status(400).send('bad url'); }

  return createProxyMiddleware({
    target: u.origin,
    changeOrigin: true,
    secure: false,
    pathRewrite: () => u.pathname + (u.search || ''),
    onProxyRes() {
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
    headers: { Referer: u.origin, Origin: u.origin },
    logLevel: 'warn',
  })(req, res, next);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Proxy listening on', PORT);
});
