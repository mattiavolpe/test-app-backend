# Tokyo Live Proxy (Fixed for HLS/CORS)

Endpoints
- `/` and `/health` -> return `ok`
- `/proxy?url=<URL-ENCODED>` -> proxies the given URL with permissive CORS headers
  Example: `/proxy?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8`

Railway Deploy
1) Put these files in a GitHub repo (root): server.js, package.json, Procfile.
2) Railway -> New Project -> Deploy from GitHub -> select repo.
3) Set Start Command to `npm start` (or leave blank to use Procfile).
4) When prompted for port, enter **3000** (Railway still injects PORT env).
5) Verify:
   - `https://<subdomain>.up.railway.app/health` -> ok
   - Try the Mux demo through proxy:
     `https://<subdomain>.up.railway.app/proxy?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8`

Use in Vercel frontend
- Set env var `VITE_PROXY_BASE` = `https://<subdomain>.up.railway.app`
- Use HLS test button in the app to confirm playback.
