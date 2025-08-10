# Tokyo Live Proxy (Manifest Rewriting, HTTPS-aware)

- `app.set('trust proxy', true)` per generare URL **https://** nel manifest quando dietro reverse proxy.
- Riscrive tutti gli URI non-commento nei `.m3u8` verso `${proxyBase}/proxy?url=<ABS_URL>`.
- CORS aperto, gestione OPTIONS, ascolto su 0.0.0.0 e PORT.

Deploy su Railway
1) Repo GitHub con: server.js, package.json, Procfile (root).
2) Railway → New Project → Deploy from GitHub.
3) Porta: usa quella suggerita da Railway (es. 8080). Start Command: `npm start` (o Procfile).
4) Test:
   - `/health` -> `ok`
   - `/proxy?url=<m3u8>` -> il browser scarica un manifest *riscritto* con URL **https://**.

Frontend (Vercel)
- `VITE_PROXY_BASE = https://<subdomain>.up.railway.app`
- Redeploy frontend e prova "Test HLS via Proxy". Niente più Mixed Content.
