# Proxy v1.9
- /getyoutube: id YouTube da data-* attrib, srcdoc, og:video, JSON-LD, link v=; BFS su *tutti* gli iframe (3 livelli).
- /gethls: BFS iframe (2 livelli). Intestazioni fetch più "browser-like" (User-Agent, Referer, Accept-Language).
- /proxy + /iframe invariati (con header migliorati).

Se un sito mostra 404/403 a bot/serverside fetch, la pagina in iframe può risultare "404". In questi casi conviene staccare l'ID YouTube o usare un HLS pubblico.
