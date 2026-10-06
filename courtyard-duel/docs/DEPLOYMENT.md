# Deployment

The game is **one Node.js process** that serves the static client *and* the WebSocket endpoint (`/ws`) on the same
port. That is all a host needs to provide:

* a **persistent process** with **WebSocket** support (not "serverless functions"),
* **HTTPS** in front of it (browsers only allow pointer lock/WebAudio features reliably on secure origins, and an `https://`
  page may only open `wss://` sockets). The client picks `wss://` automatically when the page is `https://`.
* **exactly one instance**: rooms live in that process's memory. Do not scale horizontally (there is no shared state).

> I did **not** deploy this for you (no account/credentials/authorization in the build environment). Everything below is
> ready to run; after deploying, do the [post-deploy checklist](#post-deploy-checklist) — it is the only thing that proves
> internet play, because localhost tests cannot.

Resource needs are tiny: ~1 CPU-second per ~35 concurrent matches, < 100 MB RAM, ~25 KB/s per player.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | listen address (most PaaS inject `PORT`) |
| `TRUST_PROXY` | `0` | set `1` behind a proxy/PaaS so per-IP rate limits use `X-Forwarded-For` |
| `HSTS` | `0` | set `1` once you serve HTTPS only |
| `ALLOWED_ORIGINS` | *same origin* | comma-separated extra origins allowed to open the WebSocket (CSWSH protection) |
| `WIN_ROUNDS`, `PREP_TIME_SEC`, `ROUND_TIME_SEC`, `ROUND_END_SEC`, `RECONNECT_GRACE_SEC` | 10, 10, 90, 4, 120 | match rules |
| `MAX_ROOMS`, `ROOM_TTL_MIN`, `MAX_CONN_PER_IP` | 500, 30, 8 | capacity / hygiene (idle empty rooms expire) |
| `SIM_LATENCY_MS`, `SIM_JITTER_MS` | 0 | **testing only** artificial latency |

## Option A — Render (easiest, free tier possible)

1. Push this repo (or just the `courtyard-duel/` folder) to GitHub.
2. Render dashboard → **New → Blueprint** → select the repo. It reads [`render.yaml`](../render.yaml)
   (Docker web service, 1 instance, health check `/healthz`). If the project is in a sub-folder, set *Root Directory* to
   `courtyard-duel`.
3. Wait for the build (~2 min). Your game is at `https://<name>.onrender.com` (HTTPS/WSS included).
4. Free plan caveat: the service sleeps after ~15 min idle; the first visit takes ~30–60 s to wake. Use the *Starter* plan
   for always-on.

## Option B — Fly.io

```bash
cd courtyard-duel
fly launch --no-deploy --copy-config      # accept fly.toml, choose a unique app name + region near you both
fly deploy
fly scale count 1                          # must stay at one machine
fly open
```
[`fly.toml`](../fly.toml) disables auto-stop so a sleeping machine can't drop a live match.

## Option C — your own VPS (Hetzner, DigitalOcean, …) with Caddy (automatic HTTPS)

```bash
# on the server (Ubuntu/Debian)
sudo apt install -y nodejs npm caddy        # Node >= 20 required (use nodesource/nvm if apt is older)
git clone <your repo> /opt/courtyard-duel && cd /opt/courtyard-duel/courtyard-duel
npm ci && npm run build && npm prune --omit=dev
sudo cp deploy/courtyard-duel.service /etc/systemd/system/ && sudo systemctl enable --now courtyard-duel
# edit deploy/Caddyfile (your domain), then:
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```
Point an A/AAAA DNS record at the server and open ports 80/443. Caddy gets a Let's Encrypt certificate and proxies
WebSockets without further config. An nginx equivalent (with the required `Upgrade` headers and long read timeout) is in
[`deploy/nginx.conf`](../deploy/nginx.conf).

## Option D — Docker anywhere

```bash
docker build -t courtyard-duel .
docker run -d --name duel -p 8080:8080 --restart unless-stopped courtyard-duel
```
Put it behind any TLS-terminating proxy / load balancer that forwards `Upgrade` headers (Cloudflare proxy, Traefik,
Caddy, nginx, AWS ALB — enable WebSocket support, idle timeout ≥ 60 s).

## Option E — no deployment, share your own PC for a session

```bash
npm run build && npm start
cloudflared tunnel --url http://localhost:8080     # or: ngrok http 8080
```
Open the printed `https://…` URL yourself, create the room there and send the in-game invite link. Outbound-only: no
router/port-forwarding changes, but the host's PC and its upstream bandwidth carry the match.

## Post-deploy checklist

1. `curl https://your-host/healthz` → `{"ok":true,…}`.
2. Open the site on your computer, **Create private room**; open the invite link on a **different network** (phone on mobile
   data is perfect) → both lobbies show each other; the HUD shows the ping (anything under ~100 ms feels great, under 160 ms is fine).
3. Browser dev-tools → Network → WS: the socket is `wss://your-host/ws` (101 Switching Protocols) and stays open.
4. Refresh one tab mid-match: it should rejoin the same seat and the round restarts.
5. Try the invite link in a third browser: it must say the room already has two players.

## Operations notes

* **Restarts drop rooms** (state is in memory). Players see "Room not found" and just create a new one.
* Logs show only the first 4 characters of room tokens.
* The server sends a strict Content-Security-Policy and `Referrer-Policy: no-referrer`; WebSocket upgrades from other
  origins are refused.
* Abuse limits: 8 sockets/IP, 6 room creations/min/IP, 10 bad invite tokens/min/IP, 90 msgs/s per socket (flooders are
  disconnected), 4 KB max message. Behind a proxy you **must** set `TRUST_PROXY=1`, otherwise every user shares the proxy's IP.
