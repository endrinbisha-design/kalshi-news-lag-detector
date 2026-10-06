# Test report

Environment for every result below: a Linux container (Intel Xeon @ 2.1 GHz × 4 cores, 16 GiB, Node 22, Chromium 141-era
build from Playwright) with **no GPU** (WebGL via SwiftShader software rendering) and **no public network address**.
All networking tests used `localhost`.

## What was tested, and how

| Layer | Command | Result |
|---|---|---|
| Unit: movement, collision, weapons, damage, hit regions, map symmetry/fairness (`tests/sim.test.ts`, 19) | `npm test` | **pass** |
| Unit: match/round logic, lag compensation, double-KO, rematch, disconnect (`tests/match.test.ts`, 10) | `npm test` | **pass** |
| Unit: protocol validation, name sanitising, token entropy/uniqueness, seat binding, rate-limit bucket (`tests/protocol.test.ts`, 8) | `npm test` | **pass** |
| Integration: a **real server process** + headless bot clients running the same prediction code as the browser (`tests/integration.test.ts`, 8) | `npm test` | **pass** (run 3× in a row, stable) |
| End-to-end: **two independent Chromium contexts** (separate storage) + a rejected third (`scripts/e2e.ts`, 23 checks) | `npm run build && npm run e2e` | **23/23 pass** (log: [`docs/e2e-run.log`](e2e-run.log)) |

Total: 45 automated tests + 23 browser checks.

### Verified by the tests (details)

* **Room creation / joining / limit** — create returns a 22-char (128-bit) token; joining works; a **third** client is refused
  (`full`) both at protocol level and in the browser UI ("already has two players"); unknown tokens → `no_room`; malformed
  tokens ignored; no endpoint lists rooms.
* **Reconnect cannot duplicate a player** — same secret replaces the old socket (close code 4001); a stale socket closing
  does not detach the new one; a newcomer is still refused. In the browser: Bob's tab closed → Alice sees *paused*; Bob reopens
  the link in the same browser → seat reused, round restarts, scores preserved, exactly two connected players. After the
  grace period an absent player's seat is freed and a new friend can take it.
* **Synchronised movement** — the e2e check compares each client's rendered opponent with the other client's own position:
  within 0.6 m (they matched to 0.1 m when standing; the check allows for interpolation while moving).
* **Weapon switching, firing, ammo, auto-reload, reload timing, fire-rate caps, semi-auto/bolt cadence, recoil recovery,
  spread (standing < crouched < walking < running < airborne)** — unit tests; deterministic spread verified identical for
  identical seeds (this is what lets client-predicted tracers match the server).
* **Damage / death / score / rounds** — server applies damage (AK chest 36 → 27 through armor; head ×4; legs unprotected);
  kill ends the round, point to the killer, both clients see identical scores; the next round starts with full health/armor
  and **swapped spawn sides**; timeout → draw, no point; simultaneous kills → draw; first-to-N ends the match; **rematch needs
  both players** and resets the score.
* **Walls block shots** — static: ray tests through perimeter walls, crates, the car, rim walls; server-level: shooting
  into a wall produces no hit events and a surface impact reported to the opponent.
* **Stairs/cover/collision** — walking up/down both stair types, crates/car/walls are solid, jump spam doesn't mount crates,
  and a 12 000-step random-walk fuzz from both spawns never leaves the arena or embeds the player in a solid.
* **Fairness** — the whole box list is point-symmetric (180° rotation) and a sightline test shows spawn A and spawn B see the
  same set of positions (< 1 % differences, grid sampled).
* **Robustness** — garbage JSON, oversize frames, NaN/absurd command values, floods (2 000 pings + 400 bogus messages) do not
  crash the server or disturb the other player; floods are throttled/disconnected.
* **Simulated latency** — a server started with `SIM_LATENCY_MS=60 SIM_JITTER_MS=20` (≈ 120–150 ms RTT): bots walking show
  prediction error < 5 cm; a shooter aiming at the *delayed* opponent still lands hits on a **strafing** target (lag
  compensation works); a client's reconciliation error stayed < 0.6 m while the opponent strafed.

### Not covered by automated tests

* Real audio output (the AudioContext is created and buffers are synthesised, but nobody listened in the container),
  actual **pointer lock** (tests drive the game through a test override instead of real mouse capture), touch/gamepad (not supported).
* Firefox / Safari (only Chromium was run). The code uses WebGL2, Pointer Lock, WebAudio and WebSocket, which these support,
  but it is unverified there.
* **Public-internet play.** Everything networked ran on localhost. TLS termination, NAT/firewall behaviour, real WAN
  jitter/packet loss and your host's WebSocket idle timeouts can only be verified after deploying — use the checklist in
  [DEPLOYMENT.md](DEPLOYMENT.md#post-deploy-checklist). The client picks `wss://` automatically for `https://` pages, but that
  path was only exercised in unit form (URL construction), not against a real TLS endpoint.

## Performance

**No claim of 60 FPS on a real laptop is made**, because there was no GPU. What was measured is CPU-software rendering
(SwiftShader, 4 cores), which is typically 50–200× slower than a laptop iGPU for this kind of scene; it is useful for
*relative* numbers and for checking JS cost, not as a prediction.

PERF_TABLE_PLACEHOLDER

What the numbers do tell us (device-independent): per-frame **JavaScript cost** (simulation, interpolation, effects, HUD, animation
before the render call) is `logicMs` below — on the order of a millisecond or two, so a 60 FPS (16.7 ms) budget is dominated
by GPU/driver work; **draw calls** are in the low tens thanks to merged geometry (static map ≈ 15 meshes, weapons merged per
material, characters ≈ 40 meshes), and triangle counts are in the hundreds of thousands at most.

Design measures taken for a typical laptop: merged static geometry, merged weapon/character meshes, single-draw-call GPU
particles, pooled decals/tracers/shells, constant light count (no shader recompiles), shadow map 1k/2k/4k per preset,
MSAA only on Medium/High, AO + bloom only on High, adjustable resolution and render scale, and a render-scale/preset change
applies instantly. **To measure your own machine:** Settings → Video → *Show FPS*, or open `…/?bench=1` (10 s scripted fly-through
in the practice range; prints average/p95 frame time to the console and `window.__bench`), or run `npm run perf` locally
(`CHROME=/path/to/chrome GPU=1 RES=1920x1080 npm run perf` to use your GPU).

## Limitations

* **Not deployed / internet play unverified** (see above).
* Visuals: all models are procedurally built (no suitable CC0 modern firearm models exist); they are recognisable and detailed
  but stylised, not photoreal. Hands are static glove meshes (they do not animate individual fingers).
* No player-vs-player body collision (players can walk through each other), no ladders/crouch-jump, no grenades/knife.
* The server always sends the opponent's position (wall-hack-able); `rt` lag-compensation timestamp is client-supplied but
  clamped to 250 ms; view angles are client-authoritative (aimbot-able). Acceptable for a game between friends.
* Rooms are in memory: a server restart drops them, and the server must run as a single instance.
* One map, two players, English UI only.
* Keyboard/mouse only; mouse-wheel switching toggles primary/pistol.
* Software-rendering CI is slow: the browser e2e takes ~10–15 minutes in this container.
