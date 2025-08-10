# Proxy (HLS rewrite + HTTPS + iframe fetch)
Endpoints
- `/health` -> ok
- `/proxy?url=<m3u8>` -> HLS con riscrittura dei manifest (pass-through segmenti)
- `/iframe?url=<page>` -> scarica HTML, rimuove X-Frame-Options/CSP, inietta <base> (best-effort)

Railway
- Porta: usa quella suggerita (es. 8080)
- Start: `npm start` o Procfile

Nota
- L'endpoint /iframe è "best effort": alcuni siti potrebbero avere protezioni JS ulteriori.
- Usa fonti autorizzate quando possibile.
