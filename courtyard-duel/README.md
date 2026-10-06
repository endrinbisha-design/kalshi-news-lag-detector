# Courtyard Duel

A private **1v1 tactical first-person shooter** that runs in the browser. One player creates a private room and sends a
link; the friend opens it, enters a name and they duel — first to 10 round wins. No installs, no accounts, no peer-to-peer
or port forwarding: both browsers talk to a small authoritative Node.js WebSocket server.

* **Counter-Strike-inspired** movement (no sprint, counter-strafing, crouch/walk, jump inaccuracy) and gunplay (recoil
  patterns, spread cones, armor, head/chest/stomach/arm/leg multipliers, range fall-off).
* **Six weapons**: AK-style rifle, M4-style rifle, AWP-style bolt sniper with scope, Desert-Eagle-style pistol, Glock-style
  pistol, MP5-style SMG — all stats in one file ([`src/shared/config.ts`](src/shared/config.ts)).
* **One map**, rebuilt in 3D from your reference image (three lanes, sunken centre pit with the angled car, stepped
  courtyards, crate stacks) — see [docs/MAP_NOTES.md](docs/MAP_NOTES.md).
* **Server-authoritative** movement/damage/ammo/rounds, client-side prediction + reconciliation, opponent interpolation and
  bounded (250 ms) lag compensation.
* **Solo practice range** with resettable targets while you wait for your friend.

> **Status / honesty note.** Everything below was built and tested in a sandbox without a GPU and without a public
> address. The two-browser end-to-end tests ran against `localhost` (with simulated latency). **Playing over the real
> internet needs the server deployed somewhere reachable — instructions below. I did not deploy it** (no hosting account or
> authorization in this environment). Measured performance numbers are from software rendering and are *not* a statement
> about your laptop; run the built-in benchmark to measure that ([Performance](#performance)).

---

## Quick start (play on your own machine)

Requires Node.js ≥ 20.

```bash
cd courtyard-duel
npm install
npm run build          # bundles client (dist/client) + server (dist/server)
npm start              # http://localhost:8080
```

Open <http://localhost:8080>, enter a name, **Create private room**, copy the invite link. Open the link in a second
browser window (use another profile/incognito window if testing alone) to join.

Development mode with hot reload: `npm run dev` (client on <http://localhost:5173>, server on :8080).

## Playing with a friend over the internet

The game server must be reachable by both of you over HTTPS. Pick one:

1. **Deploy it (recommended, permanent link)** — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) has copy-paste steps for
   **Render**, **Fly.io**, a **VPS with Caddy/nginx** and **Docker**. All terminate TLS so the game uses `https://` +
   `wss://` automatically.
2. **Quick one-off from your own PC (no deploy)** — run `npm start`, then expose it with a tunnel that supports
   WebSockets and gives you an HTTPS URL:
   ```bash
   cloudflared tunnel --url http://localhost:8080      # prints https://something.trycloudflare.com
   ```
   Open that URL (not `localhost`) yourself, create the room, send the generated link to your friend. Your PC must stay on.
   No port forwarding needed; the connection is outbound-only.

**Inviting your friend:** in the lobby press **Copy link** and send it by any chat app. The link looks like
`https://your-host/#r=<22-character-random-token>`. It is private (128-bit token, no public room list), limited to two
players, and the token sits after the `#`, so it is never sent to the server in an HTTP request or logged.
Your friend opens it → types a name → **Join the duel**. While you wait you can practise on the range
(press <kbd>Esc</kbd> any time to copy the link again). If your friend's tab refreshes or drops, the same link (or just
reopening the page: the room is remembered per tab) puts them back in the same seat and the round restarts — they cannot appear twice.

## Controls (all rebindable in Settings)

| Action | Default |
|---|---|
| Move | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (no sprint) |
| Look | Mouse (pointer lock; click the game to capture) |
| Jump | <kbd>Space</kbd> |
| Crouch (hold) | <kbd>C</kbd> |
| Walk silently (hold) | <kbd>Shift</kbd> |
| Fire / Scope (AWP, two zoom levels) | Left mouse / Right mouse |
| Reload | <kbd>R</kbd> |
| Primary / pistol / last weapon | <kbd>1</kbd> / <kbd>2</kbd> / <kbd>Q</kbd> (mouse wheel toggles too) |
| Pick loadout during the preparation phase | click a card or <kbd>3</kbd>–<kbd>6</kbd> primary, <kbd>7</kbd>–<kbd>8</kbd> pistol |
| Scoreboard | hold <kbd>Tab</kbd> |
| Minimap toggle | <kbd>M</kbd> |
| Practice: reset targets / loadout menu | <kbd>T</kbd> / <kbd>B</kbd> |
| Menu / settings / copy invite | <kbd>Esc</kbd> |

> `Ctrl` is deliberately not the default crouch: browsers reserve <kbd>Ctrl</kbd>+<kbd>W</kbd> and closing your tab
> mid-fight is no fun.

**Settings:** mouse sensitivity (CS-style, 0.022°/count × value; scaled correctly when scoped), invert-Y, FOV, master and
effects volume, graphics preset (Low / Medium / High), resolution (native or 1920×1080 … 960×540), render scale 50–100 %,
FPS counter, crosshair size/gap/thickness/colour/dot, minimap rotation, every key binding. Stored in the browser.

## Match rules

First to **10 round wins**. Each round: 10 s preparation (frozen, choose primary + pistol), 90 s round timer, **100 health +
100 armor**. A kill wins the round; if the timer runs out it's a **draw — no point, round restarts**; if both players die in
the same server tick it is also a draw. Spawn sides alternate each round. Over → victory/defeat screen with **Rematch**
(both players must accept). All numbers are server-side environment variables (`WIN_ROUNDS`, `PREP_TIME_SEC`,
`ROUND_TIME_SEC`, … see [`.env.example`](.env.example)).

## Weapons

| | Damage | Rate | Mag / reserve | Reload | Notes |
|---|---|---|---|---|---|
| AK-style | 36 | 600 rpm | 30 / 90 | 2.45 s | strongest rifle, noticeable climbing/wobbling recoil |
| M4-style | 33 | 666 rpm | 30 / 90 | 3.05 s | tighter pattern, easier control |
| AWP-style | 115 | 41 rpm (bolt) | 5 / 30 | 3.4 s | scope ×2 levels, one-shot to the body, very inaccurate unscoped or moving |
| Desert-Eagle-style | 63 | 267 rpm | 7 / 35 | 2.2 s | huge kick, semi-auto |
| Glock-style | 28 | 400 rpm | 20 / 120 | 2.2 s | light, fast follow-up |
| MP5-style | 26 | 750 rpm | 30 / 120 | 2.6 s | rapid, manageable recoil, damage falls off with range (×0.84 per 12.7 m) |

Hit regions: head ×4, stomach ×1.25, chest/arms ×1, legs ×0.75; armor absorbs a weapon-specific share (not on legs).
Walls, crates and the car block shots (no penetration).

## Performance

Target: smooth 60 FPS at 1920×1080 on a typical modern laptop with the **Medium** preset; **Low** is for weak iGPUs
(no MSAA/AO, 1k shadows) and **High** adds ambient occlusion + bloom + 4k shadows.
I could only test with CPU software rendering (no GPU in the sandbox; 0.9–2.2 FPS at 640×360), so I do **not** claim a measured laptop FPS — the
numbers I got and how to measure your own are in [docs/TEST_REPORT.md](docs/TEST_REPORT.md#performance). In your browser
press <kbd>Esc</kbd> → Settings → Video → *Show FPS*, or open the game with `?bench=1` to run a 10 s fly-through benchmark
and print average/p95 frame time to the console.

## Project layout

```
src/shared/   deterministic simulation used by BOTH client and server
  config.ts     every tunable: movement, match rules, damage model, all weapon stats, recoil patterns, sound params
  map.ts        the arena as oriented boxes (authored in reference-image pixels)
  world.ts      collision (circle-vs-OBB, stairs), ray casts
  player.ts     movement + weapon state machine (one fixed 60 Hz step), spread/recoil
  hit.ts        hit regions + damage formula
  match.ts      rooms' authoritative state: rounds, scoring, lag-compensated shot resolution, targets
  protocol.ts   message types + strict validation
src/server/   Node http + ws server (static files, rooms, rate limits, simulated latency)
src/client/   Three.js renderer, procedural models/audio, HUD/menus, prediction & interpolation
tests/        vitest unit + real-server integration tests with headless bot clients
scripts/      e2e.ts (two real browsers), perf.ts, mapsvg.ts
docs/         DEPLOYMENT, MAP_NOTES, ASSET_CREDITS, ARCHITECTURE, TEST_REPORT
```

## Tests

```bash
npm test               # unit + integration (starts real server processes, 2 headless bot clients, simulated lag)
npm run e2e            # two real Chromium browsers + a rejected third (needs `npm run build` first)
npm run perf           # frame-time benchmark in headless Chromium (software GL) for each preset
```

See [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for results and the list of what is **not** proven (public-internet play).

## Known limitations

See the end of [docs/TEST_REPORT.md](docs/TEST_REPORT.md#limitations).
