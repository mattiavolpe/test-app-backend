// server.js — HLS proxy + HTTPS + iframe + improved getyoutube (BFS across iframes) + gethls
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.set('trust proxy', true);

app.use(cors({
  origin: '*', methods: ['GET','HEAD','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Range']
}));
app.options('*', cors());

app.get('/', (_req,res)=>res.status(200).send('ok'));
app.get('/health', (_req,res)=>res.status(200).send('ok'));

// utils
function toAbsolute(baseUrl, maybeRelative) {
  try { return new URL(maybeRelative).href; }
  catch {
    const base = new URL(baseUrl);
    if (maybeRelative.startsWith('//')) return base.protocol + maybeRelative; // protocol-relative
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
      const htmls = await bfsIframeHtmls(targetUrl, html, 2);
      for(const h of htmls){
        found = extractM3U8(h.html);
        if(found) { break; }
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

app.get('/getyoutube', async (req,res)=>{
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error:'missing url' });
  try{
    const mainHtml = await (await fetch(targetUrl, { headers:{ 'User-Agent':'Mozilla/5.0' } })).text();
    let id = pickYouTubeId(targetUrl, mainHtml);
    if(!id){
      const htmls = await bfsIframeHtmls(targetUrl, mainHtml, 3); // explore broader than before
      for(const h of htmls){
        id = pickYouTubeId(h.url, h.html);
        if(id) break;
      }
    }
    if(!id) return res.status(404).json({ error:'no youtube id found' });
    return res.json({ id });
  }catch(e){
    console.error('getyoutube error', e);
    res.status(502).json({ error:'getyoutube error' });
  }
});

// ---- helpers ----
function extractM3U8(html){
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

function pickYouTubeId(baseUrl, html){
  // 1) direct embed urls
  const embed = /youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/i.exec(html);
  if(embed) return embed[1];
  const shorty = /youtu\.be\/([a-zA-Z0-9_-]{11})/i.exec(html);
  if(shorty) return shorty[1];

  // 2) videoId in JSON
  const vid1 = /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/i.exec(html);
  if(vid1) return vid1[1];
  const vid2 = /'videoId'\s*:\s*'([a-zA-Z0-9_-]{11})'/i.exec(html);
  if(vid2) return vid2[1];

  // 3) og:video:url or ld+json embedUrl
  const og = /<meta[^>]+property=["']og:video:url["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if(og){
    const m = /embed\/([a-zA-Z0-9_-]{11})/.exec(og[1]); if(m) return m[1];
    const v = /[?&]v=([a-zA-Z0-9_-]{11})/.exec(og[1]); if(v) return v[1];
  }
  const ld = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let mld; 
  while((mld = ld.exec(html))){
    try{
      const data = JSON.parse(mld[1]);
      // handle both object and array
      const items = Array.isArray(data) ? data : [data];
      for(const it of items){
        const emb = it.embedUrl || (it.video && it.video.embedUrl);
        if(typeof emb === 'string'){
          const m = /embed\/([a-zA-Z0-9_-]{11})/.exec(emb); if(m) return m[1];
          const v = /[?&]v=([a-zA-Z0-9_-]{11})/.exec(emb); if(v) return v[1];
        }
      }
    }catch(_){}
  }

  // 4) generic links with v= param
  const vq = /(?:youtube\.com\/watch\?[^"'<>]*[?&]v=|[?&]v=)([a-zA-Z0-9_-]{11})/i.exec(html);
  if(vq) return vq[1];

  // 5) srcdoc content inside iframes
  const srcdoc = /<iframe[^>]+srcdoc=['"]([\s\S]*?)['"]/i.exec(html);
  if(srcdoc){
    const inner = htmlEntityDecode(srcdoc[1]);
    const em2 = /youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/i.exec(inner);
    if(em2) return em2[1];
    const v2 = /[?&]v=([a-zA-Z0-9_-]{11})/i.exec(inner);
    if(v2) return v2[1];
  }

  return null;
}

function htmlEntityDecode(s){
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

async function bfsIframeHtmls(baseUrl, html, depth){
  const visited = new Set();
  const queue = [];
  // collect ALL iframe srcs, not just the first
  const iframes = [...html.matchAll(/<iframe[^>]+src=['"]([^'"]+)['"]/gi)];
  for(const m of iframes){
    const u = toAbsolute(baseUrl, m[1]);
    if(!visited.has(u)){ visited.add(u); queue.push({url:u, d:1}); }
  }
  const out = [];
  while(queue.length){
    const node = queue.shift();
    try{
      const r = await fetch(node.url, { headers:{ 'User-Agent':'Mozilla/5.0' } });
      const h = await r.text();
      out.push({ url: node.url, html: h });
      if(node.d < depth){
        const subs = [...h.matchAll(/<iframe[^>]+src=['"]([^'"]+)['"]/gi)];
        for(const m of subs){
          const u2 = toAbsolute(node.url, m[1]);
          if(!visited.has(u2)){
            visited.add(u2);
            queue.push({url:u2, d:node.d+1});
          }
        }
      }
    }catch(_){}
  }
  return out;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log('Proxy listening on',PORT));
