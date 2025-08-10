# Proxy v1.9.1
Fix: regex in letterali → ora con `new RegExp()` (compatibile anche con Node 22).
Funzioni:
- /proxy (riscrive manifest HLS)
- /iframe (proxy HTML con base)
- /gethls (BFS su iframe, 2 livelli)
- /getyoutube (BFS su iframe, 3 livelli; data-*, srcdoc, meta, JSON-LD, v=)

Suggerimento Railway: imposta PORT a 8080 se richiesto in fase di probing.
