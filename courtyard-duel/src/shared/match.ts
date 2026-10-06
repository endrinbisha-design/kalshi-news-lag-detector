import { DEFAULT_LOADOUT, DT, Loadout, MatchConfig, NET, SNAPSHOT_EVERY, TICK_RATE, WEAPONS, WeaponId } from './config';
import { computeDamage, rayBody, BodyPose } from './hit';
import { lerp, lerpAngle } from './math';
import { MAP, SpawnPoint, TargetSpot } from './map';
import { Cmd, PlayerState, SimEvent, createPlayerState, currentWeapon, stepPlayer } from './player';
import { GameEvent, OpponentSnap, PHASES, Phase, PlayerInfo, RoomInfo, Snapshot, TargetSnap } from './protocol';
import { World } from './world';

interface HistorySample { t: number; x: number; y: number; z: number; yaw: number; crouch: number }

interface SimPlayer {
  slot: number;
  name: string;
  connected: boolean;
  ping: number;
  state: PlayerState | null;
  loadout: Loadout;
  queue: Cmd[];
  budget: number;
  lastSeq: number;
  highSeq: number; // highest seq ever accepted into the queue
  epoch: number;
  score: number;
  kills: number;
  deaths: number;
  rematch: boolean;
  history: HistorySample[];
}

interface Target {
  id: number;
  spot: TargetSpot;
  x: number; y: number; z: number; yaw: number;
  hp: number; armor: number;
  deadFor: number; // seconds since death, -1 alive
}

interface PendingShot { shooter: SimPlayer; ev: Extract<SimEvent, { k: 'shot' }>; rt: number }

export type Emit = (slot: number, msg: object) => void;

export interface SimOptions {
  config: MatchConfig;
  mode: 'duel' | 'practice';
  world?: World;
  emit: Emit;
  randomSeed?: () => number;
}

/**
 * Authoritative simulation of one room: players, rounds, scoring, validated hitscan with bounded lag compensation.
 * It is transport-agnostic: the Node server wraps it with WebSockets, the browser's practice mode runs it in-page.
 */
export class MatchSim {
  readonly cfg: MatchConfig;
  readonly mode: 'duel' | 'practice';
  readonly world: World;
  players: [SimPlayer, SimPlayer];
  phase: Phase;
  phaseT = 0;
  round = 1;
  tick = 0;
  epoch = 0;
  private startCount = 0;
  private emit: Emit;
  private rand: () => number;
  private targets: Target[] = [];
  private winner = -1;
  private lastRound = -2;
  private lastRoundReason = '';
  private pausedFrom: Phase | null = null;
  private pending: PendingShot[] = [];
  private evOut: [GameEvent[], GameEvent[]] = [[], []];
  private roomDirty = true;
  private roomTimer = 0;

  constructor(opts: SimOptions) {
    this.cfg = opts.config;
    this.mode = opts.mode;
    this.world = opts.world ?? new World(MAP);
    this.emit = opts.emit;
    this.rand = opts.randomSeed ?? Math.random;
    const mk = (slot: number): SimPlayer => ({
      slot, name: '', connected: false, ping: 0, state: null, loadout: { ...DEFAULT_LOADOUT },
      queue: [], budget: 0, lastSeq: 0, highSeq: 0, epoch: 0, score: 0, kills: 0, deaths: 0, rematch: false, history: [],
    });
    this.players = [mk(0), mk(1)];
    this.phase = opts.mode === 'practice' ? 'practice' : 'waiting';
    if (opts.mode === 'practice') this.resetTargets();
  }

  get timeMs(): number { return (this.tick * 1000) / TICK_RATE; }

  // ------------------------------------------------------------------ membership
  connect(slot: number, name: string): void {
    const p = this.players[slot];
    p.name = name;
    p.connected = true;
    p.queue.length = 0;
    p.highSeq = 0; // a (re)connecting client restarts its sequence numbers
    p.lastSeq = 0;
    this.roomDirty = true;
    if (this.mode === 'practice') {
      if (!p.state) this.spawnPractice();
      return;
    }
    if (this.phase === 'paused' || this.phase === 'waiting') this.tryStart();
    else if (p.state) {
      // reconnect during an active phase: keep state, resync happens through snapshots
    }
  }

  disconnect(slot: number): void {
    const p = this.players[slot];
    if (!p.connected) return;
    p.connected = false;
    p.queue.length = 0;
    p.rematch = false;
    this.roomDirty = true;
    if (this.mode === 'practice') return;
    if (this.phase === 'prep' || this.phase === 'live' || this.phase === 'roundEnd') {
      this.pausedFrom = this.phase;
      this.phase = 'paused';
      this.phaseT = this.cfg.reconnectGraceSeconds;
    } else if (this.phase === 'matchEnd') {
      // stay on the result screen; rematch is impossible until the opponent returns
    }
  }

  private tryStart(): void {
    if (this.mode !== 'duel') return;
    if (!this.players[0].connected || !this.players[1].connected) return;
    if (this.phase === 'waiting') {
      this.round = 1;
      this.startCount = 0;
      this.startRound(true);
    } else if (this.phase === 'paused') {
      // restart the interrupted round without awarding anything and without flipping sides
      this.startRound(false);
    }
  }

  setLoadout(slot: number, lo: Loadout): void {
    const p = this.players[slot];
    p.loadout = { ...lo };
    this.roomDirty = true;
    if ((this.phase === 'prep' || this.mode === 'practice') && p.state && p.state.alive) {
      const fresh = createPlayerState({ x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.yaw }, lo, p.state.seed);
      fresh.vx = fresh.vz = 0;
      p.state = fresh;
    }
  }

  voteRematch(slot: number): void {
    if (this.phase !== 'matchEnd' || this.mode !== 'duel') return;
    if (!this.players[0].connected || !this.players[1].connected) return;
    this.players[slot].rematch = true;
    this.roomDirty = true;
    if (this.players[0].rematch && this.players[1].rematch) {
      for (const p of this.players) { p.score = 0; p.kills = 0; p.deaths = 0; p.rematch = false; }
      this.round = 1;
      this.startCount = 0;
      this.winner = -1;
      this.lastRound = -2;
      this.lastRoundReason = '';
      this.startRound(true);
    }
  }

  /** A player intentionally left: end any running match and clear their seat. */
  leave(slot: number): void {
    const p = this.players[slot];
    p.connected = false;
    p.name = '';
    p.queue.length = 0;
    p.state = null;
    p.rematch = false;
    if (this.mode === 'duel') this.abandon();
    this.roomDirty = true;
  }

  setPing(slot: number, ms: number): void { this.players[slot].ping = Math.round(ms); }

  /** Practice: respawn the player, refill ammo, reset all targets. */
  resetPractice(): void {
    if (this.mode !== 'practice') return;
    this.spawnPractice();
    this.resetTargets();
  }

  // ------------------------------------------------------------------ input
  input(slot: number, ep: number, cmds: Cmd[]): void {
    const p = this.players[slot];
    if (!p.state || ep !== p.epoch) return;
    for (const c of cmds) {
      if (c.seq <= p.highSeq) continue;
      if (p.queue.length >= NET.maxQueuedCmds) { p.queue.shift(); }
      p.queue.push(c);
      p.highSeq = c.seq;
    }
  }

  // ------------------------------------------------------------------ rounds
  private seedRand(): number { return Math.floor(this.rand() * 4294967296) >>> 0; }

  private spawnFor(slot: number): SpawnPoint {
    const side = (this.startCount + slot) % 2; // alternate sides each round
    return MAP.spawns[side];
  }

  private startRound(advanceSide: boolean): void {
    if (advanceSide) this.startCount++;
    this.epoch++;
    for (const p of this.players) {
      const sp = this.spawnFor(p.slot);
      p.state = createPlayerState(sp, p.loadout, this.seedRand());
      p.state.vx = 0;
      p.epoch = this.epoch;
      p.queue.length = 0;
      p.budget = 0;
      p.history.length = 0;
      p.lastSeq = Math.max(p.lastSeq, p.highSeq);
    }
    this.pending.length = 0;
    this.phase = 'prep';
    this.phaseT = this.cfg.prepSeconds;
    this.pausedFrom = null;
    this.roomDirty = true;
  }

  private spawnPractice(): void {
    const p = this.players[0];
    this.epoch++;
    p.state = createPlayerState(MAP.practiceSpawn, p.loadout, this.seedRand());
    p.epoch = this.epoch;
    p.queue.length = 0;
    p.lastSeq = Math.max(p.lastSeq, p.highSeq);
    p.history.length = 0;
  }

  private resetTargets(): void {
    this.targets = MAP.targets.map((spot, i) => ({
      id: i, spot, x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw, hp: 100, armor: 100, deadFor: -1,
    }));
  }

  private endRound(winner: number, reason: string): void {
    this.lastRound = winner;
    this.lastRoundReason = reason;
    if (winner >= 0) { this.players[winner].score++; }
    const sc: [number, number] = [this.players[0].score, this.players[1].score];
    this.pushEv(2, { k: 'round', winner, reason, sc, round: this.round });
    if (winner >= 0) this.round++;
    this.phase = 'roundEnd';
    this.phaseT = this.cfg.roundEndSeconds;
    this.roomDirty = true;
    const w = sc[0] >= this.cfg.winRounds ? 0 : sc[1] >= this.cfg.winRounds ? 1 : -1;
    if (w >= 0) this.winner = w;
  }

  // ------------------------------------------------------------------ events
  private pushEv(to: 0 | 1 | 2, e: GameEvent): void {
    if (to === 2) { this.evOut[0].push(e); this.evOut[1].push(e); } else this.evOut[to].push(e);
  }

  // ------------------------------------------------------------------ main tick
  step(): void {
    this.tick++;
    const now = this.timeMs;

    // phase timers
    if (this.phase === 'prep') {
      this.phaseT -= DT;
      if (this.phaseT <= 0) { this.phase = 'live'; this.phaseT = this.cfg.roundSeconds; this.pushEv(2, { k: 'live' }); this.roomDirty = true; }
    }

    const acting = this.phase === 'prep' || this.phase === 'live' || this.phase === 'roundEnd' || this.phase === 'practice';
    if (acting) {
      for (const p of this.players) this.processPlayer(p);
      this.resolveShots(now);
    }

    if (this.phase === 'live') {
      this.phaseT -= DT;
      const dead = this.players.filter((p) => p.state && !p.state.alive);
      if (dead.length === 2) this.endRound(-1, 'double');
      else if (dead.length === 1) this.endRound(1 - dead[0].slot, 'kill');
      else if (this.phaseT <= 0) this.endRound(-1, 'timeout');
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= DT;
      if (this.phaseT <= 0) {
        if (this.winner >= 0) {
          this.phase = 'matchEnd';
          this.phaseT = 0;
          this.pushEv(2, { k: 'match', winner: this.winner });
          this.roomDirty = true;
        } else this.startRound(true);
      }
    } else if (this.phase === 'paused') {
      this.phaseT -= DT;
      if (this.phaseT <= 0) this.abandon();
    }

    if (this.mode === 'practice') this.stepTargets();

    // record history for lag compensation
    for (const p of this.players) {
      if (!p.state) continue;
      p.history.push({ t: now, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.state.yaw, crouch: p.state.crouch });
      const cutoff = now - NET.historyMs;
      while (p.history.length > 2 && p.history[0].t < cutoff) p.history.shift();
    }

    // outgoing
    this.roomTimer += DT;
    if (this.roomDirty || this.roomTimer >= 1) { this.roomTimer = 0; this.roomDirty = false; this.sendRoom(); }
    for (let s = 0; s < 2; s++) {
      if (this.evOut[s].length) {
        if (this.players[s].connected) this.emit(s, { t: 'ev', e: this.evOut[s] });
        this.evOut[s] = [];
      }
    }
    if (this.tick % SNAPSHOT_EVERY === 0) {
      for (let s = 0; s < 2; s++) if (this.players[s].connected) this.sendSnapshot(s);
    }
  }

  /** Seats whose occupant never came back before the match was dropped (the server frees them for new players). */
  released: number[] = [];

  /** Grace period expired: the match is dropped and the room waits for players again. */
  private abandon(): void {
    for (const p of this.players) if (!p.connected && p.name) { this.released.push(p.slot); p.name = ''; }
    for (const p of this.players) { p.score = 0; p.kills = 0; p.deaths = 0; p.state = null; p.rematch = false; }
    this.phase = 'waiting';
    this.round = 1;
    this.winner = -1;
    this.lastRound = -2;
    this.pausedFrom = null;
    this.roomDirty = true;
    this.pending.length = 0;
  }

  private processPlayer(p: SimPlayer): void {
    const st = p.state;
    if (!st) return;
    // Time budget: at most one cmd per tick (plus a small catch-up allowance) so clients cannot speed-hack.
    p.budget = Math.min(p.budget + DT * (p.queue.length > 4 ? 1.15 : 1), DT * 6);
    const frozen = this.phase === 'prep';
    while (p.queue.length && p.budget >= DT - 1e-9) {
      const cmd = p.queue.shift()!;
      p.budget -= DT;
      p.lastSeq = cmd.seq;
      if (!st.alive) continue;
      const evs: SimEvent[] = [];
      let c = cmd;
      if (this.phase === 'roundEnd') c = { ...cmd, buttons: cmd.buttons & ~(128 | 512) }; // no firing after the round is decided
      stepPlayer(st, c, this.world, { frozen }, evs);
      this.handleSimEvents(p, evs, cmd);
    }
  }

  private handleSimEvents(p: SimPlayer, evs: SimEvent[], cmd: Cmd): void {
    const st = p.state!;
    const other = (1 - p.slot) as 0 | 1;
    for (const e of evs) {
      switch (e.k) {
        case 'shot': this.pending.push({ shooter: p, ev: e, rt: cmd.rt }); break;
        case 'reload': this.pushEv(other, { k: 'reload', who: p.slot, w: e.w }); break;
        case 'switch': this.pushEv(other, { k: 'switch', who: p.slot, slot: e.slot, w: st.wids[e.slot] }); break;
        case 'step': this.pushEv(other, { k: 'step', who: p.slot, x: st.x, y: st.y, z: st.z, surf: e.surf }); break;
        case 'jump': this.pushEv(other, { k: 'jump', who: p.slot, x: st.x, y: st.y, z: st.z }); break;
        case 'land': this.pushEv(other, { k: 'land', who: p.slot, x: st.x, y: st.y, z: st.z, surf: e.surf }); break;
      }
    }
  }

  // ------------------------------------------------------------------ hit resolution with lag compensation
  private poseAt(p: SimPlayer, t: number): BodyPose | null {
    const st = p.state;
    if (!st) return null;
    const h = p.history;
    if (h.length === 0 || t >= h[h.length - 1].t) return { x: st.x, y: st.y, z: st.z, yaw: st.yaw, crouch: st.crouch };
    if (t <= h[0].t) { const s = h[0]; return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, crouch: s.crouch }; }
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1], b = h[i];
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), yaw: lerpAngle(a.yaw, b.yaw, k), crouch: lerp(a.crouch, b.crouch, k) };
      }
    }
    return { x: st.x, y: st.y, z: st.z, yaw: st.yaw, crouch: st.crouch };
  }

  private resolveShots(now: number): void {
    if (!this.pending.length) return;
    const shots = this.pending;
    this.pending = [];
    interface Dmg { victim: SimPlayer; attacker: SimPlayer; region: any; dmg: number; armorLoss: number; w: WeaponId; dist: number; fx: number; fy: number; fz: number }
    const damages: Dmg[] = [];

    for (const s of shots) {
      const { ev, shooter } = s;
      const def = WEAPONS[ev.w];
      const wh = this.world.raycast(ev.ox, ev.oy, ev.oz, ev.dx, ev.dy, ev.dz, def.maxRange);
      let tEnd = wh ? wh.t : def.maxRange;
      let surf: any = wh ? wh.mat : '';
      let n = wh ? [wh.nx, wh.ny, wh.nz] : [0, 0, 0];
      let hitPlayer = 0;

      if (this.phase !== 'roundEnd') {
        const rtc = Math.min(now, Math.max(now - NET.lagCompMaxMs, s.rt > 0 ? s.rt : now));
        if (this.mode === 'duel') {
          const victim = this.players[1 - shooter.slot];
          if (victim.state && victim.state.alive) {
            const pose = this.poseAt(victim, rtc);
            const hit = pose ? rayBody(pose, ev.ox, ev.oy, ev.oz, ev.dx, ev.dy, ev.dz, tEnd) : null;
            if (hit) {
              tEnd = hit.t; hitPlayer = 1; surf = ''; n = [0, 0, 0];
              const d = computeDamage(def, hit.region, hit.t, victim.state.armor);
              damages.push({ victim, attacker: shooter, region: hit.region, dmg: d.health, armorLoss: d.armor, w: ev.w, dist: hit.t, fx: ev.ox + ev.dx * hit.t, fy: ev.oy + ev.dy * hit.t, fz: ev.oz + ev.dz * hit.t });
            }
          }
        } else {
          // practice targets: no rewind needed (zero latency)
          let best: { t: number; region: any; tg: Target } | null = null;
          for (const tg of this.targets) {
            if (tg.deadFor >= 0) continue;
            const hit = rayBody({ x: tg.x, y: tg.y, z: tg.z, yaw: tg.yaw, crouch: 0 }, ev.ox, ev.oy, ev.oz, ev.dx, ev.dy, ev.dz, best ? best.t : tEnd);
            if (hit) best = { t: hit.t, region: hit.region, tg };
          }
          if (best) {
            tEnd = best.t; hitPlayer = 1; surf = ''; n = [0, 0, 0];
            const d = computeDamage(def, best.region, best.t, best.tg.armor);
            best.tg.hp -= d.health;
            best.tg.armor = Math.max(0, best.tg.armor - d.armor);
            const kill = best.tg.hp <= 0 ? 1 : 0;
            if (kill) { best.tg.hp = 0; best.tg.deadFor = 0; }
            this.pushEv(0, { k: 'thit', id: best.tg.id, region: best.region, dmg: d.health, armorLoss: d.armor, hp: best.tg.hp, kill, w: ev.w, dist: best.t });
          }
        }
      }

      const shotEv: GameEvent = {
        k: 'shot', who: shooter.slot, w: ev.w, ox: ev.ox, oy: ev.oy, oz: ev.oz,
        ex: ev.ox + ev.dx * tEnd, ey: ev.oy + ev.dy * tEnd, ez: ev.oz + ev.dz * tEnd,
        surf, nx: n[0], ny: n[1], nz: n[2], hit: hitPlayer, n: ev.n,
      };
      this.pushEv(1 - shooter.slot as 0 | 1, shotEv);
    }

    // apply all damage simultaneously so a same-tick trade is a trade
    const killed = new Set<SimPlayer>();
    for (const d of damages) {
      const st = d.victim.state!;
      if (!st.alive && !killed.has(d.victim)) continue;
      st.hp -= d.dmg;
      st.armor = Math.max(0, st.armor - d.armorLoss);
      let kill = 0;
      if (st.hp <= 0) { st.hp = 0; kill = 1; killed.add(d.victim); }
      this.pushEv(2, { k: 'hit', by: d.attacker.slot, victim: d.victim.slot, region: d.region, dmg: d.dmg, armorLoss: d.armorLoss, hp: st.hp, armor: st.armor, kill, w: d.w, dist: d.dist, fx: d.fx, fy: d.fy, fz: d.fz });
      if (kill) this.pushEv(2, { k: 'kill', killer: d.attacker.slot, victim: d.victim.slot, w: d.w, head: d.region === 'head' ? 1 : 0 });
    }
    for (const v of killed) {
      v.state!.alive = 0;
      v.deaths++;
      const k = this.players[1 - v.slot];
      k.kills++;
      v.state!.vx = v.state!.vz = 0;
    }
    if (killed.size) this.roomDirty = true;
  }

  private stepTargets(): void {
    for (const t of this.targets) {
      if (t.deadFor >= 0) {
        t.deadFor += DT;
        if (t.deadFor > 3) { t.hp = 100; t.armor = 100; t.deadFor = -1; }
        continue;
      }
      const s = t.spot;
      if (s.x2 !== undefined && s.z2 !== undefined && s.speed) {
        const len = Math.hypot(s.x2 - s.x, s.z2 - s.z);
        const ph = ((this.tick * DT * s.speed) / len) % 2;
        const k = ph < 1 ? ph : 2 - ph;
        t.x = lerp(s.x, s.x2, k); t.z = lerp(s.z, s.z2, k);
      }
    }
  }

  // ------------------------------------------------------------------ outgoing messages
  private info(p: SimPlayer): PlayerInfo | null {
    if (!p.name) return null;
    return { name: p.name, connected: p.connected, loadout: p.loadout, rematch: p.rematch, kills: p.kills, deaths: p.deaths, score: p.score, ping: p.ping };
  }

  roomInfo(slot: number): RoomInfo {
    return {
      t: 'room', phase: this.phase, round: this.round, slot, cfg: this.cfg,
      players: [this.info(this.players[0]), this.info(this.players[1])],
      winner: this.winner, lastRound: this.lastRound, lastRoundReason: this.lastRoundReason,
    };
  }

  private sendRoom(): void {
    for (let s = 0; s < 2; s++) if (this.players[s].connected) this.emit(s, this.roomInfo(s));
  }

  snapshotFor(slot: number): Snapshot | null {
    const p = this.players[slot];
    const me = p.state;
    if (!me) return null;
    const o = this.players[1 - slot];
    let op: OpponentSnap | null = null;
    if (this.mode === 'duel' && o.state && o.connected) {
      const s = o.state;
      op = {
        x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, vx: s.vx, vz: s.vz,
        ground: s.ground, alive: s.alive, wid: s.wids[s.weapon], reloading: s.reloadT > 0 ? 1 : 0, zoom: s.zoom,
      };
    }
    const snap: Snapshot = {
      t: 'snap', k: this.tick, st: this.timeMs, ack: p.lastSeq, ep: p.epoch,
      ph: PHASES.indexOf(this.phase), pt: Math.max(0, this.phaseT), rd: this.round,
      sc: [this.players[0].score, this.players[1].score], me, op,
    };
    if (this.mode === 'practice') {
      snap.tg = this.targets.map<TargetSnap>((t) => ({ id: t.id, x: t.x, y: t.y, z: t.z, yaw: t.yaw, hp: t.hp, dead: t.deadFor >= 0 ? 1 : 0 }));
    }
    return snap;
  }

  private sendSnapshot(slot: number): void {
    const s = this.snapshotFor(slot);
    if (s) this.emit(slot, s);
  }

  /** Test/debug helper. */
  weapon(slot: number) { return this.players[slot].state ? currentWeapon(this.players[slot].state!) : null; }
}
