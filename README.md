# Tokyo Live Proxy (Minimal Fixed)

File inclusi:
- server.js (Express + http-proxy-middleware)
- package.json (start script)
- Procfile (web: node server.js) — consigliato per Railway/Heroku style

Note per Railway:
1) Crea una repo GitHub con questi file nella root.
2) Railway → New Project → Deploy from GitHub.
3) In Settings → Start Command: lascia vuoto (usa Procfile) oppure setta `npm start`.
4) Quando chiede la porta, indica **3000** (comunque usa process.env.PORT).
5) Verifica / e /health restituiscano `ok`:
   https://<tuo-subdominio>.up.railway.app/
   https://<tuo-subdominio>.up.railway.app/health
