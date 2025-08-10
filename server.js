// server.js — Proxy v1.11
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const fetch = require('node-fetch');

const VERSION = '1.11.0';
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
app.get('/version', (_req,res)=>res.json({ version: VERSION }));

function toAbsolute(baseUrl, maybeRelative) {
  try { return new URL(maybeRelative).href; }
  catch {
    const base = new URL(baseUrl);
    if (maybeRelative.startsWith('//')) return base.protocol + maybeRelative;
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

const commonHeaders = (targetUrl)=>{
  const u = new URL(targetUrl);
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,it;q=0.8,ja;q=0.8',
    'Referer': u.origin + '/',
    'Cache-Control': 'no-cache'
  };
};

app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('missing url');
  let origin;
  try { origin = new URL(targetUrl).origin; } catch { return res.status(400).send('bad url'); }
  const proxyBase = `${req.protocol}://${req.get('host')}`;
  console.log('[proxy] →', targetUrl);
  return createProxyMiddleware({
    target: origin, changeOrigin:true, secure:false, selfHandleResponse:true,
    pathRewrite: (_p,_r) => { const u = new URL(targetUrl); return u.pathname + (u.search||''); },
    onProxyReq: (proxyReq)=>{
      const h = commonHeaders(targetUrl);
      Object.entries(h).forEach(([k,v])=> proxyReq.setHeader(k,v));
    },
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
            console.log('[proxy] manifest rewritten OK');
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
  console.log('[iframe] →', targetUrl);
  try{
    const r = await fetch(targetUrl, { headers: commonHeaders(targetUrl) });
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

app.get(['/gethls','/api/gethls'], async (req,res)=>{
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error:'missing url' });
  console.log('[gethls] →', targetUrl);
  try{
    const html = await (await fetch(targetUrl, { headers: commonHeaders(targetUrl) })).text();
    let found = extractM3U8(html);
    if(!found){
      const htmls = await bfsIframeHtmls(targetUrl, html, 2);
      for(const h of htmls){
        found = extractM3U8(h.html);
        if(found) break;
      }
    }
    if(!found) { console.log('[gethls] none'); return res.status(404).json({ error:'no m3u8 found' }); }
    let absUrl = found;
    try { new URL(absUrl); } catch { absUrl = toAbsolute(targetUrl, absUrl); }
    console.log('[gethls] OK', absUrl);
    return res.json({ url: absUrl });
  }catch(e){
    console.error('gethls error', e);
    res.status(502).json({ error:'gethls error' });
  }
});

app.get(['/getyoutube','/api/getyoutube'], async (req,res)=>{
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error:'missing url' });
  console.log('[getyoutube] →', targetUrl);
  try{
    const mainHtml = await (await fetch(targetUrl, { headers: commonHeaders(targetUrl) })).text();
    // Skyline-style direct iframe
    const iframeMatch = /<iframe[^>]+(?:id=["']live["'][^>]*|class=["'][^"']*embed-responsive-item[^"']*["'])[^>]*src=["']([^"']+)["'][^>]*>/i.exec(mainHtml);
    if(iframeMatch){
      const full = toAbsolute(targetUrl, iframeMatch[1]);
      const idMatch = /\/embed\/([a-zA-Z0-9_-]{11})/.exec(full) || /[?&]v=([a-zA-Z0-9_-]{11})/.exec(full);
      console.log('[getyoutube] skyline-direct', full);
      return res.json({ id: idMatch ? idMatch[1] : undefined, fullUrl: full, source: 'skyline-direct' });
    }
    // Fallback: previous robust methods
    let id = pickYouTubeId(mainHtml);
    if(!id){
      const htmls = await bfsIframeHtmls(targetUrl, mainHtml, 3);
      for(const h of htmls){
        id = pickYouTubeId(h.html);
        if(id) break;
      }
    }
    if(!id) { console.log('[getyoutube] none'); return res.status(404).json({ error:'no youtube id found' }); }
    console.log('[getyoutube] id', id);
    return res.json({ id, source: 'fallback' });
  }catch(e){
    console.error('getyoutube error', e);
    res.status(502).json({ error:'getyoutube error' });
  }
});

function extractM3U8(html){
  const patternStrings = [
    String.raw`https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*`,
    String.raw`['"]([^'"]+\.m3u8[^'"]*)['"]`,
    String.raw`file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]`,
    String.raw`source\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]`,
    String.raw`src\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]`,
    String.raw`playlist\s*:\s*\[\s*['"]([^'"]+\.m3u8[^'"]*)['"]`
  ];
  const patterns = patternStrings.map(p => new RegExp(p, 'gi'));
  for(const p of patterns){
    const m = p.exec(html);
    if(m){ return (m[1]||m[0]).replace(/^['"]|['"]$/g,''); }
  }
  return null;
}

function pickYouTubeId(html){
  const patternStrings = [
    String.raw`youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})`,
    String.raw`youtu\.be\/([a-zA-Z0-9_-]{11})`,
    String.raw`data-(?:src|url|video|embed|youtube|ytid)=["']([^"']+)["']`,
    String.raw`["']videoId["']\s*:\s*["']([a-zA-Z0-9_-]{11})["']`,
    String.raw`<meta[^>]+property=["']og:video:url["'][^>]+content=["']([^"']+)["']`,
    String.raw`<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>`,
    String.raw`<iframe[^>]+srcdoc=['"]([\s\S]*?)['"]`,
    String.raw`(?:youtube\.com\/watch\?[^"'<>]*[?&]v=|[?&]v=)([a-zA-Z0-9_-]{11})`
  ];
  const patterns = patternStrings.map(p => new RegExp(p, 'gi'));

  let m = patterns[0].exec(html); if(m) return m[1];
  m = patterns[1].exec(html); if(m) return m[1];
  m = patterns[2].exec(html);
  if(m){
    const s = m[1];
    let em = /embed\/([a-zA-Z0-9_-]{11})/.exec(s) || /[?&]v=([a-zA-Z0-9_-]{11})/.exec(s);
    if(em) return em[1];
  }
  m = patterns[3].exec(html); if(m) return m[1];
  m = patterns[4].exec(html);
  if(m){
    const s = m[1];
    let em = /embed\/([a-zA-Z0-9_-]{11})/.exec(s) || /[?&]v=([a-zA-Z0-9_-]{11})/.exec(s);
    if(em) return em[1];
  }
  let mld;
  while((mld = patterns[5].exec(html))){
    try{
      const data = JSON.parse(mld[1]);
      const items = Array.isArray(data) ? data : [data];
      for(const it of items){
        const emb = (it && (it.embedUrl || (it.video && it.video.embedUrl)));
        if(typeof emb === 'string'){
          let em = /embed\/([a-zA-Z0-9_-]{11})/.exec(emb) || /[?&]v=([a-zA-Z0-9_-]{11})/.exec(emb);
          if(em) return em[1];
        }
      }
    }catch(_){}
  }
  m = patterns[6].exec(html);
  if(m){
    const inner = m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    let em = /youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/i.exec(inner) || /[?&]v=([a-zA-Z0-9_-]{11})/i.exec(inner);
    if(em) return em[1];
  }
  m = patterns[7].exec(html); if(m) return m[1];
  return null;
}

async function bfsIframeHtmls(baseUrl, html, depth){
  const visited = new Set();
  const queue = [];
  const iframes = [...html.matchAll(/<iframe[^>]+src=['"]([^'"]+)['"]/gi)];
  for(const m of iframes){
    const u = toAbsolute(baseUrl, m[1]);
    if(!visited.has(u)){ visited.add(u); queue.push({url:u, d:1}); }
  }
  const out = [];
  while(queue.length){
    const node = queue.shift();
    try{
      const r = await fetch(node.url, { headers: commonHeaders(node.url) });
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
app.listen(PORT,'0.0.0.0',()=>console.log('Proxy listening on',PORT, 'v'+VERSION));
