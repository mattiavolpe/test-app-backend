// server.js - Proxy semplice per HLS/HTTP
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.get('/health', (_req, res) => res.send('ok'));

app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');

  try {
    const u = new URL(targetUrl);
    // Creo dinamicamente un middleware che punta al dominio della risorsa
    return createProxyMiddleware({
      target: u.origin,
      changeOrigin: true,
      secure: false,
      // Ricostruisco path+query della risorsa originale
      pathRewrite: () => u.pathname + (u.search || ''),
      onProxyRes(proxyRes) {
        // CORS aperto: fa sì che il browser accetti la risposta
        res.setHeader('Access-Control-Allow-Origin', '*');
      },
      // opzionale: headers per siti pignoli
      headers: { Referer: u.origin, Origin: u.origin },
      logLevel: 'warn',
    })(req, res, next);
  } catch (e) {
    return res.status(400).send('bad url');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Proxy listening on', PORT));
