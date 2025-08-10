# Proxy v1.8
- /proxy: HLS con riscrittura manifest
- /iframe: proxy HTML best-effort
- /gethls: estrae .m3u8; BFS su tutti gli iframe fino a 2 livelli
- /getyoutube: estrae ID YouTube; BFS su tutti gli iframe fino a 3 livelli, parsing srcdoc, meta og:video, JSON-LD, link con v=

Nota: se un video YouTube è bloccato (privato/geo/embargo), l'embed può risultare "non disponibile".
