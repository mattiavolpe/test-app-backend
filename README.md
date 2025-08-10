# Tokyo Live Proxy with Manifest Rewriting

Fix per HLS con URL relativi:
- Riscrive ogni riga non-commento dei manifest `.m3u8` in un URL proxato:
  `${proxyBase}/proxy?url=<ABSOLUTE_URL>`
- I segmenti `.ts`/`.m4s` passano diretti (no riscrittura necessaria).

Deploy su Railway
1) Crea repo GitHub con: server.js, package.json, Procfile (root).
2) Railway → New Project → Deploy from GitHub → seleziona repo.
3) Porta: usa quella suggerita da Railway (es. 8080). Va bene così.
4) Start Command: `npm start` (o lascia vuoto per usare il Procfile).
5) Test:
   - `https://<subdomain>.up.railway.app/health` -> `ok`
   - `https://<subdomain>.up.railway.app/proxy?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8`
     -> il browser scarica un .m3u8 riscritto (ok)

Uso nel frontend
- In Vercel imposta `VITE_PROXY_BASE = https://<subdomain>.up.railway.app`
- Premi "Test HLS via Proxy": ora il player carica manifest + segmenti senza 404.
