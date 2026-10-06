# Architecture & netcode

```
Browser A ──wss──┐                          ┌── Browser B
 prediction      ├─►  Node process  ◄──────┤   prediction
 interpolation   │   MatchSim (60 Hz tick) │   interpolation
                 └── rooms ─ validation ───┘
```

## One simulation, two places

`src/shared/player.ts::stepPlayer(state, cmd, world, opts)` is a pure function that advances one player by exactly one
60 Hz tick: view angles → crouch → Source-style friction/acceleration/air-accel → jump (no auto-bunny-hop) → circle-vs-OBB
collision with 0.5 m step-up for stairs → gravity/landing → weapon state machine (switch, reload, bolt cycle, fire rate,
spread, recoil pattern). The **server** runs it for authority; the **client** runs the same function for prediction, so
what you feel is what the server computes.

Bullet spread is deterministic: `hash(seed, shotCounter)` where `seed` is assigned by the server each round. The client's
predicted tracer and impact therefore land where the server's ray lands.

## Client → server

* The client samples input at a fixed 60 Hz (`Cmd {seq, buttons, yaw, pitch, slot, rt}`) and sends batches every 2 ticks.
* The server queues commands per player and consumes **at most one per tick** with a small catch-up budget (cap ≈ 100 ms), so
  a client cannot speed-hack by sending extra commands, yet jitter doesn't stutter.
* Every field is validated (finite, in range, integer where required, max 12 commands/message, 4 KB/message); sockets that
  flood are dropped; invalid frames are ignored.

## Server → client

* Snapshots at 30 Hz: your full authoritative `PlayerState` (+ `ack` = last command processed) and a reduced opponent pose.
* Events (immediate): shots (for opponent audio/tracers), hits, kills, footsteps/jump/land, reload/switch, round/match.
* **Reconciliation**: on each snapshot the client discards acknowledged commands, replays the rest on top of the
  authoritative state, and smooths any visible difference away over ~90 ms (a snap > 2.5 m is taken instantly). A new
  `epoch` (round start / rejoin) resets prediction.
* **Opponent interpolation**: rendered 100 ms in the past between two snapshots (clock offset estimated from snapshot
  timestamps + RTT/2).

## Lag compensation (bounded)

Each shot command carries `rt`, the server-time of the opponent state the shooter was looking at (`now − interp delay`).
The server keeps 1 s of per-tick history for each player and resolves the ray against the opponent's pose at
`clamp(rt, now − 250 ms, now)`. Therefore a shooter with high latency can only "reach back" 250 ms, a client that lies
about `rt` gains at most that, and nobody is shot "around corners" by more than that window. Walls are static, so the ray is
tested against the current (static) world. Simultaneous kills in the same tick are resolved together and produce a draw.

## Rounds

`waiting → prep (frozen, loadout) → live → roundEnd → prep …`, `matchEnd` at the win target; `paused` when a player drops
(grace period, then the match is abandoned and the seat is freed). Spawn sides alternate per round. Kill ⇒ point; timeout or
double-KO ⇒ draw, same score, round restarts.

## Privacy / identity

* Room token = 16 random bytes (`crypto.randomBytes`), base64url, in the URL **hash**.
* A seat is bound to a per-browser random `secret` (never shown to the other player). Re-joining with the same secret
  replaces the old socket (close code 4001), so refresh/reconnect cannot create a duplicate player.
* No room list endpoint exists.

## Known gaps

The server always sends the opponent's position (a wall-hack cheat is possible); there is no player-vs-player body
collision; there is no voice/text chat. Fine for a game between two friends.
