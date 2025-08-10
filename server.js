// server.js — HLS proxy + HTTPS + iframe + improved gethls (one-level iframe follow)
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.set('trust proxy', true);

app.use(cors({
  origin: '*',
  methods: ['GET','HEAD','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Range']
}));
app.options('*', cors());

app.get('/', (_req,res)=>res.status(200).send('ok'));
app.get('/health', (_req,res)=>res.status(200).send('ok'));

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

app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');
  let origin;
  try { origin = new URL(targetUrl).origin; } catch { return res.status(400).send('bad url'); }
  const proxyBase = `${req.protocol}://${req.get('host')}`;
  return createProxyMiddleware({
    target: origin, changeOrigin:true, secure:false, selfHandleResponse:true,
    pathRewrite: (_p,_r) => { const u = new URL(targetUrl); return u.pathname + (u.search||''); },
    onProxyRes: async (proxyRes, _req2, res2) => {
      try {
        const chunks = []; proxyRes.on('data', c => chunks.push(c)); proxyRes.on('end', ()=>{
          const buf = Buffer.concat(chunks);
          const ct = (proxyRes.headers['content-type']||'').toLowerCase();
          const isManifest = ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl') || (req.query.url||'').toLowerCase().includes('.m3u8');
          Object.keys(proxyRes.headers).forEach(h => { if(h.toLowerCase()!=='content-length') res2.setHeader(h, proxyRes.headers[h]); });
          res2.setHeader('Access-Control-Allow-Origin','*');
          res2.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Range');
          res2.setHeader('Access-Control-Allow-Methods','GET,HEAD,OPTIONS');
          if(isManifest){
            const text = buf.toString('utf8');
            const rewritten = rewriteManifest(req.query.url, text, proxyBase);
            const out = Buffer.from(rewritten,'utf8');
            res2.setHeader('content-type','application/vnd.apple.mpegurl');
            res2.setHeader('content-length', out.length);
            return res2.status(proxyRes.statusCode||200).end(out);
          } else {
            res2.status(proxyRes.statusCode||200); return res2.end(buf);
          }
        });
      } catch(e){ console.error('onProxyRes error',e); res2.status(502).send('proxy error'); }
    },
    headers: { Referer: origin, Origin: origin },
    logLevel: 'warn',
  })(req,res,next);
});

app.get('/iframe', async (req,res)=>{
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');
  try{
    const r = await fetch(targetUrl, { headers:{ 'User-Agent':'Mozilla/5.0' } });
    const html = await r.text();
    const u = new URL(targetUrl);
    let patched = html;
    if (/<head[^>]*>/i.test(patched)) patched = patched.replace(/<head[^>]*>/i, m => `${m}\n<base href="${u.origin}/">`);
    else patched = `<head><base href="${u.origin}/"></head>${patched}`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.status(200).send(patched);
  }catch(e){ console.error('iframe error',e); res.status(502).send('iframe proxy error'); }
});

app.get('/gethls', async (req,res)=>{
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error:'missing url' });
  try{
    const html = await (await fetch(targetUrl, { headers:{ 'User-Agent':'Mozilla/5.0' } })).text();
    let found = extractM3U8(html);
    if(!found){
      const ifr = findFirstIframeSrc(html);
      if(ifr){
        const abs = toAbsolute(targetUrl, ifr);
        const html2 = await (await fetch(abs, { headers:{ 'User-Agent':'Mozilla/5.0' } })).text();
        found = extractM3U8(html2, abs);
        if(!found){
          const ifr2 = findFirstIframeSrc(html2);
          if(ifr2){
            const abs2 = toAbsolute(abs, ifr2);
            const html3 = await (await fetch(abs2, { headers:{ 'User-Agent':'Mozilla/5.0' } })).text();
            found = extractM3U8(html3, abs2);
          }
        }
      }
    }
    if(!found) return res.status(404).json({ error:'no m3u8 found' });
    let absUrl = found;
    try { new URL(absUrl); } catch { absUrl = toAbsolute(targetUrl, absUrl); }
    return res.json({ url: absUrl });
  }catch(e){
    console.error('gethls error', e);
    res.status(502).json({ error:'gethls error' });
  }
});

function extractM3U8(html, base){
  const patterns = [
    /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
    /['"]([^'"]+\.m3u8[^'"]*)['"]/gi,
    /file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/gi,
    /source\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/gi,
    /src\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/gi,
    /playlist\s*:\s*\[\s*['"]([^'"]+\.m3u8[^'"]*)['"]/gi
  ];
  for(const p of patterns){
    const m = p.exec(html);
    if(m){ return (m[1]||m[0]).replace(/^['"]|['"]$/g,''); }
  }
  return null;
}
function findFirstIframeSrc(html){
  const m = /<iframe[^>]+src=['"]([^'"]+)['"]/i.exec(html);
  return m ? m[1] : null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log('Proxy listening on',PORT));
