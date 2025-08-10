// server.js — Express proxy with HLS/CORS fixes (Railway-ready)
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();

// Global CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range']
}));
app.options('*', cors());

// Health endpoints
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Proxy endpoint: GET /proxy?url=<encoded target URL>
app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');

  let u;
  try { u = new URL(targetUrl); } catch (_e) { return res.status(400).send('bad url'); }

  console.log(`[proxy] ${u.href}`);

  return createProxyMiddleware({
    target: u.origin,
    changeOrigin: true,
    secure: false,
    // Rebuild path+query exactly as the origin expects
    pathRewrite: () => u.pathname + (u.search || ''),
    // Add permissive CORS on the response for browser playback
    onProxyRes(proxyRes) {
      proxyRes.headers['Access-Control-Allow-Origin'] = '*';
      proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Range';
      proxyRes.headers['Access-Control-Allow-Methods'] = 'GET,HEAD,OPTIONS';
    },
    // Some origins require Referer/Origin
    headers: { Referer: u.origin, Origin: u.origin },
    logLevel: 'warn',
  })(req, res, next);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Proxy listening on', PORT);
});
