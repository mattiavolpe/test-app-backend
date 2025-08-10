# Proxy (HLS rewrite + HTTPS + iframe + gethls)
Endpoints
- `/health` -> ok
- `/proxy?url=<m3u8>` -> HLS con riscrittura manifest
- `/iframe?url=<page>` -> proxied HTML (best-effort)
- `/gethls?url=<page>` -> estrae il primo URL `.m3u8` trovato nella pagina e lo restituisce in JSON

Note
- `gethls` usa regex generiche per trovare `.m3u8` in HTML/JS e normalizza URL relativi.
- Non tutte le pagine espongono HLS pubblico; alcune usano player proprietari/token.
