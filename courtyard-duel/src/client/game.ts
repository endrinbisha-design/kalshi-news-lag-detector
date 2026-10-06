import * as THREE from 'three';
import { BTN, DT, MATCH, NET, WEAPONS, WeaponId, Loadout, DEFAULT_LOADOUT, PISTOLS, PRIMARIES } from '../shared/config';
import { DEG, clamp, forwardVec, lerp, lerpAngle } from '../shared/math';
import { MAP } from '../shared/map';
import { World } from '../shared/world';
import { Cmd, PlayerState, SimEvent, cloneState, copyState, currentSpread, currentWeapon, eyeHeight, stepPlayer } from '../shared/player';
import { GameEvent, OpponentSnap, PHASES, Phase, RoomInfo, ServerMsg, Snapshot, TargetSnap } from '../shared/protocol';
import { audio } from './audio';
import { Input } from './input';
import { INTERP_DELAY_MS, NetStatus, OnlineSession, PracticeSession, Session } from './net';
import { RelayGuestSession, RelayHostSession } from './relay';
import { Stage, SUN_DIR } from './render/stage';
import { loadMaterials } from './render/textures';
import { buildMapMeshes } from './render/mapBuilder';
import { Effects } from './render/effects';
import { ViewModel } from './render/viewmodel';
import { Character, DUMMY_STYLE, TEAM_STYLES } from './render/models/character';
import { Settings, onSettings, settings } from './settings';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';

export interface GameHost {
  onStatus(status: NetStatus, detail?: string): void;
  onRoom(room: RoomInfo | null): void;
  onLockChange(locked: boolean): void;
  onMatchEnd(winnerSlot: number, mySlot: number, scores: [number, number], names: [string, string]): void;
  onMatchRestart(): void;
}

interface OppSample { st: number; op: OpponentSnap }
const LOADOUT_KEY = 'courtyard-duel.loadout';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

/** Orchestrates rendering, input, prediction/reconciliation, interpolation, effects, audio and HUD. */
export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly stage: Stage;
  readonly input: Input;
  readonly hud: Hud;
  readonly world = new World(MAP);
  private minimap: Minimap;
  private fx!: Effects;
  private vm = new ViewModel();
  private opChar: Character | null = null;
  private opCharSlot = -1;
  private dummies: { ch: Character; bar: THREE.Group; fg: THREE.Mesh; lastHp: number; id: number }[] = [];
  loaded = false;

  // ---- sessions
  private practice: PracticeSession | null = null;
  private net: Session | null = null;
  relayCode = '';
  private source: 'none' | 'practice' | 'net' = 'none';
  private mySlot = 0;
  room: RoomInfo | null = null;
  netStatus: NetStatus = 'closed';
  netDetail = '';
  private roomToken = '';
  private myName = 'You';

  // ---- prediction
  private pred: PlayerState | null = null;
  private prevPos = new THREE.Vector3();
  private pending: Cmd[] = [];
  private outbox: Cmd[] = [];
  private seq = 0;
  private epoch = -1;
  private errOffset = new THREE.Vector3();
  private acc = 0;
  private tickCount = 0;
  private yaw = 0; private pitch = 0;
  private lookDX = 0; private lookDY = 0;
  private wantSlot = -1;
  private wantScope = false;
  private lastSlot = 0;
  private flinch = 0;
  testOverride: { buttons: number; yaw?: number; pitch?: number; slot?: number } | null = null;

  // ---- latest server info
  private phase: Phase = 'waiting';
  private phaseT = 0;
  private phaseStamp = 0;
  private round = 1;
  private scores: [number, number] = [0, 0];
  private oppBuf: OppSample[] = [];
  private clockSamples: number[] = [];
  private clockOffset = 0;
  private haveClock = false;
  private lastSnapAt = 0;
  private loadout: Loadout = { ...DEFAULT_LOADOUT };

  // ---- view state
  private fov = 70;
  private deadT = 0;
  private spreadPx = 0;
  private lastReloadProg = 0;
  private opReloadStart = 0;
  private opReloading = false;
  private opLastReloadProg = 0;
  private lastHp = 100;
  private shake = 0;
  private practiceLast = '';
  private scoreboardHeld = false;
  paused = true;

  // ---- perf
  fps = 0;
  frameMs: number[] = [];
  logicMs: number[] = []; renderMs: number[] = [];
  private frameT0 = 0;
  private lastFrame = 0;
  private fpsAcc = 0; private fpsFrames = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, private host: GameHost) {
    this.canvas = canvas;
    this.stage = new Stage(canvas);
    this.input = new Input(canvas);
    this.hud = new Hud(hudRoot);
    this.minimap = new Minimap(this.hud.minimap);
    this.hud.onPickLoadout = (p, q) => this.setLoadout({ primary: p, pistol: q });
    this.input.onLockChange = (l) => { this.paused = !l; this.host.onLockChange(l); if (!l) this.hud.scoreboard(false); };
    this.input.onPressed = (code) => this.onKey(code);
    try { const raw = localStorage.getItem(LOADOUT_KEY); if (raw) { const lo = JSON.parse(raw); if (PRIMARIES.includes(lo.primary) && PISTOLS.includes(lo.pistol)) this.loadout = lo; } } catch { /* ignore */ }
    onSettings((s) => this.applySettings(s));
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.lastFrame = performance.now(); });
  }

  // ====================================================================== lifecycle
  async load(progress: (f: number) => void): Promise<void> {
    const mats = await loadMaterials(import.meta.env.BASE_URL, this.stage.maxAnisotropy, progress);
    const arena = buildMapMeshes(mats, this.stage.maxAnisotropy);
    this.stage.scene.add(arena.group);
    this.fx = new Effects(this.stage.scene, this.world, this.stage.muzzleLight);
    this.stage.viewScene.add(this.vm.root);
    this.vm.setWeapon('ak47');
    this.applySettings(settings);
    this.loaded = true;
    if (!this.running) { this.running = true; this.lastFrame = performance.now(); requestAnimationFrame((t) => this.frame(t)); }
  }

  private applySettings(s: Settings): void {
    this.onResize();
    this.stage.applySettings(s);
    this.fx?.setRenderHeight(this.stage.internalH);
    audio.setVolume(s.volume, s.sfxVolume);
    this.hud.applySettings(s);
    this.minimap.rotate = s.minimapRotate;
  }

  private onResize(): void {
    this.stage.resize(window.innerWidth, window.innerHeight, settings);
    this.fx?.setRenderHeight(this.stage.internalH);
  }

  /** Begin (or restart) solo practice. */
  startPractice(name: string): void {
    this.myName = name || 'You';
    this.stopPractice();
    const p = new PracticeSession(this.myName, { ...MATCH }, this.loadout);
    p.onMessage = (m) => this.onMessage(m, 'practice');
    this.practice = p;
    this.switchSource('practice');
    p.start();
  }

  private stopPractice(): void { this.practice = null; }

  startOnline(opts: { create?: boolean; room?: string; name: string; lagMs?: number }): void {
    this.myName = opts.name || 'Player';
    this.net?.close();
    this.roomToken = opts.room ?? '';
    const n = new OnlineSession(opts);
    this.net = n;
    n.onMessage = (m) => this.onMessage(m, 'net');
    n.onStatus = (s, d) => { this.netStatus = s; this.netDetail = d ?? ''; this.host.onStatus(s, d); };
    // lobby: practise locally until the friend arrives
    this.startPractice(this.myName);
  }

  /** Artifact relay mode: host runs the authoritative sim in this tab; guest connects through the claude.ai room relay. */
  startRelay(sess: RelayHostSession | RelayGuestSession, name: string): void {
    this.myName = name || 'Player';
    this.net?.close();
    this.roomToken = '';
    this.relayCode = sess.code;
    this.net = sess;
    sess.onMessage = (m) => this.onMessage(m, 'net');
    sess.onStatus = (s, d) => { this.netStatus = s; this.netDetail = d ?? ''; this.host.onStatus(s, d); };
    this.startPractice(this.myName);
    void sess.start();
  }

  leaveRoom(): void {
    this.relayCode = '';
    try { history.replaceState(null, '', location.pathname + location.search); sessionStorage.removeItem('courtyard-duel.room'); } catch { /* ignore */ }
    this.net?.leave();
    this.net = null;
    this.room = null;
    this.roomToken = '';
    this.host.onRoom(null);
    this.hud.setInvite(null);
    this.startPractice(this.myName);
  }

  get roomLink(): string { return this.roomToken ? `${location.origin}${location.pathname}#r=${this.roomToken}` : ''; }
  get inRoom(): boolean { return !!this.net; }
  get mode(): 'practice' | 'duel' { return this.source === 'net' ? 'duel' : 'practice'; }
  get currentPhase(): Phase { return this.phase; }
  get slot(): number { return this.mySlot; }
  get ping(): number { return this.net?.rtt ?? 0; }

  rematch(): void { this.net?.rematch(); }

  setLoadout(lo: Loadout): void {
    this.loadout = { ...lo };
    try { localStorage.setItem(LOADOUT_KEY, JSON.stringify(lo)); } catch { /* ignore */ }
    this.activeSession()?.sendLoadout(lo.primary, lo.pistol);
    this.hud.showLoadout(this.loadoutVisible(), this.loadout);
  }

  private activeSession(): Session | null {
    return this.source === 'net' ? this.net : this.source === 'practice' ? this.practice : null;
  }

  private loadoutOpen = false;
  private loadoutVisible(): boolean { return (this.source === 'practice' && this.loadoutOpen) || (this.source === 'net' && this.phase === 'prep'); }

  private switchSource(src: 'practice' | 'net'): void {
    if (this.source === src) return;
    this.source = src;
    this.pred = null; this.pending = []; this.outbox = []; this.epoch = -1; this.oppBuf = [];
    this.errOffset.set(0, 0, 0);
    this.fx?.clearDecals();
    this.hud.clearBanner();
    this.clearDummies();
    this.hud.deathMessage(null);
    this.hud.scope(false);
    this.hud.practicePanel(src === 'practice', this.practiceLast);
    this.loadoutOpen = false;
    this.hud.showLoadout(false, this.loadout);
    if (src === 'practice') { this.phase = 'practice'; this.scores = [0, 0]; }
    this.mySlot = src === 'net' ? this.mySlot : 0;
    this.vm.setSleeve(TEAM_STYLES[this.mySlot].shirt);
    this.hud.setNames(this.myName, src === 'net' ? (this.room?.players[1 - this.mySlot]?.name ?? 'Opponent') : 'Targets');
    this.hud.setScore(0, 0);
    if (src === 'net') { this.net?.sendLoadout(this.loadout.primary, this.loadout.pistol); }
    if (src === 'practice') { this.host.onMatchRestart(); }
  }

  // ====================================================================== messages
  private onMessage(m: ServerMsg, from: 'practice' | 'net'): void {
    switch (m.t) {
      case 'joined':
        if (from === 'net') {
          this.mySlot = m.slot; this.roomToken = this.relayCode ? '' : m.room;
          if (!this.relayCode) { try { history.replaceState(null, '', location.pathname + location.search + '#r=' + m.room); sessionStorage.setItem('courtyard-duel.room', m.room); } catch { /* ignore */ } }
          this.setClock(m.time);
          this.net?.sendLoadout(this.loadout.primary, this.loadout.pistol);
          this.updateInvite();
        } else this.setClock(m.time, true);
        return;
      case 'room':
        if (from === 'net') this.onRoom(m);
        return;
      case 'pong':
        return;
      case 'err':
        return;
      case 'bye':
        return;
      case 'snap':
        if ((from === 'net') === (this.source === 'net')) this.onSnapshot(m);
        return;
      case 'ev':
        if ((from === 'net') === (this.source === 'net')) for (const e of m.e) this.onEvent(e);
        return;
    }
  }

  private setClock(serverMs: number, local = false): void {
    if (local) { this.haveClock = true; this.clockOffset = 0; return; }
    this.clockOffset = serverMs - performance.now();
    this.haveClock = true;
    this.clockSamples = [];
  }

  private serverNow(): number {
    if (this.source === 'practice' && this.practice) return this.practice.simTimeMs;
    return performance.now() + this.clockOffset;
  }

  private onRoom(r: RoomInfo): void {
    this.room = r;
    this.mySlot = r.slot;
    this.host.onRoom(r);
    const active = r.phase !== 'waiting';
    if (active) {
      if (this.source !== 'net') this.switchSource('net');
    } else if (this.source === 'net') {
      this.startPractice(this.myName);
    }
    const op = r.players[1 - r.slot];
    this.hud.setNames(r.players[r.slot]?.name ?? this.myName, this.source === 'net' ? (op?.name ?? 'Opponent') : 'Targets');
    this.phase = r.phase === 'waiting' ? 'practice' : r.phase;
    if (this.source === 'net') {
      this.scores = [r.players[0]?.score ?? 0, r.players[1]?.score ?? 0];
      this.hud.setScore(this.scores[r.slot], this.scores[1 - r.slot]);
    }
    this.updateInvite();
    this.updatePhaseUi();
    if (r.phase === 'matchEnd' && r.winner >= 0) {
      this.host.onMatchEnd(r.winner, r.slot, [r.players[0]?.score ?? 0, r.players[1]?.score ?? 0], [r.players[0]?.name ?? '', r.players[1]?.name ?? '']);
    }
    if (r.phase === 'prep' || r.phase === 'live') this.host.onMatchRestart();
  }

  private updateInvite(): void {
    // only while practising solo inside an open room (not during a match / pause)
    const practising = this.source === 'practice';
    const opp = this.room?.players[1 - (this.room?.slot ?? 0)];
    this.hud.setInvite(this.net && (this.roomToken || this.relayCode) && practising && !opp?.connected
      ? (this.relayCode ? `<b>Duel open (code ${this.relayCode}).</b> Practising solo while you wait. Your friend opens this same page and clicks <b>Join</b> next to your name.`
        : `<b>Room ready.</b> Practising solo while you wait. Press <kbd>Esc</kbd> to copy the invite link and send it to your friend.`)
      : null);
  }

  private updatePhaseUi(): void {
    const h = this.hud;
    h.showLoadout(this.loadoutVisible(), this.loadout);
    if (this.source !== 'net') { h.bigMessage(null); return; }
    if (this.phase === 'paused') {
      h.bigMessage('Opponent disconnected', `Waiting for them to reconnect… the round restarts when they are back (up to ${MATCH.reconnectGraceSeconds}s).`);
    } else if (this.room && this.phase === 'matchEnd' && !this.room.players[1 - this.room.slot]?.connected) {
      h.bigMessage('Opponent left', 'Rematch is unavailable until they return.');
    } else h.bigMessage(null);
  }

  // ====================================================================== snapshots + reconciliation
  private onSnapshot(s: Snapshot): void {
    const now = performance.now();
    if (this.source === 'net') {
      // clock estimate: max over a window of (serverTime - arrival) then add half the RTT
      const sample = s.st - now;
      this.clockSamples.push(sample);
      if (this.clockSamples.length > 40) this.clockSamples.shift();
      const est = Math.max(...this.clockSamples) + (this.net?.rtt ?? 0) / 2;
      this.clockOffset = this.haveClock && this.clockSamples.length > 5 ? this.clockOffset + (est - this.clockOffset) * 0.08 : est;
      this.haveClock = true;
    }
    this.lastSnapAt = now;
    const newPhase = PHASES[s.ph];
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this.updatePhaseUi();
    }
    this.phaseT = s.pt; this.phaseStamp = now;
    this.round = s.rd;
    if (this.source === 'net') {
      this.scores = s.sc;
      this.hud.setScore(s.sc[this.mySlot], s.sc[1 - this.mySlot]);
    }
    if (s.op) {
      this.oppBuf.push({ st: s.st, op: s.op });
      if (this.oppBuf.length > 24) this.oppBuf.shift();
    }
    if (s.tg) this.onTargets(s.tg);

    if (s.ep !== this.epoch) {
      // new round / respawn / (re)join: adopt the authoritative state outright
      this.epoch = s.ep;
      this.pending = []; this.outbox = [];
      this.pred = cloneState(s.me);
      this.prevPos.set(s.me.x, s.me.y, s.me.z);
      this.errOffset.set(0, 0, 0);
      this.yaw = s.me.yaw; this.pitch = 0;
      this.deadT = 0;
      this.oppBuf = s.op ? [{ st: s.st, op: s.op }] : [];
      this.fx?.clearDecals();
      this.hud.deathMessage(null);
      this.lastHp = s.me.hp;
      return;
    }
    // drop acknowledged commands, replay the rest on top of the authoritative state
    let i = 0;
    while (i < this.pending.length && this.pending[i].seq <= s.ack) i++;
    if (i > 0) this.pending.splice(0, i);
    const rec = cloneState(s.me);
    const frozen = this.phase === 'prep';
    const sink: SimEvent[] = [];
    if (rec.alive) for (const c of this.pending) { sink.length = 0; stepPlayer(rec, c, this.world, { frozen }, sink); }
    if (this.pred) {
      const dx = this.pred.x - rec.x, dy = this.pred.y - rec.y, dz = this.pred.z - rec.z;
      const err = Math.hypot(dx, dy, dz);
      if (err > 2.5) this.errOffset.set(0, 0, 0);
      else if (err > 0.002) this.errOffset.add(_v1.set(dx, dy, dz));
    }
    // keep the authoritative health / armor / alive (they only change on the server)
    this.pred = rec;
    if (s.me.hp < this.lastHp) this.lastHp = s.me.hp; else this.lastHp = s.me.hp;
  }

  private onTargets(tg: TargetSnap[]): void {
    if (this.dummies.length === 0) {
      for (const t of tg) {
        const ch = new Character(DUMMY_STYLE);
        this.stage.scene.add(ch.root);
        const bar = new THREE.Group();
        const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.07), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthTest: false }));
        const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.05), new THREE.MeshBasicMaterial({ color: 0x7dff9a, depthTest: false }));
        fg.position.z = 0.001; bg.renderOrder = 5; fg.renderOrder = 6;
        bar.add(bg, fg);
        this.stage.scene.add(bar);
        this.dummies.push({ ch, bar, fg, lastHp: 100, id: t.id });
      }
    }
    for (let i = 0; i < tg.length; i++) {
      const t = tg[i], d = this.dummies[i];
      if (!d) continue;
      d.ch.update(1 / 60, { x: t.x, y: t.y, z: t.z, yaw: t.yaw, pitch: 0, crouch: 0, vx: 0, vz: 0, ground: true, alive: !t.dead, wid: null, reloading: false });
      d.lastHp = t.hp;
      d.fg.scale.x = Math.max(0.001, t.hp / 100);
      d.fg.position.x = -0.3 * (1 - t.hp / 100);
      d.bar.position.set(t.x, t.y + 2.05, t.z);
      d.bar.visible = !t.dead;
    }
  }

  private clearDummies(): void {
    for (const d of this.dummies) { this.stage.scene.remove(d.ch.root); this.stage.scene.remove(d.bar); }
    this.dummies = [];
  }

  // ====================================================================== events
  private nameOf(slot: number): string {
    if (this.source !== 'net') return slot === 0 ? this.myName : 'Target';
    return this.room?.players[slot]?.name ?? (slot === this.mySlot ? this.myName : 'Opponent');
  }

  private onEvent(e: GameEvent): void {
    const me = this.mySlot;
    switch (e.k) {
      case 'shot': {
        if (e.who === me) return; // predicted locally
        this.remoteShot(e);
        return;
      }
      case 'hit': {
        if (e.by === me) {
          this.hud.hitMarker(e.kill ? 'kill' : e.region === 'head' ? 'head' : 'hit');
          audio.ui(e.kill ? 'hit_kill' : e.region === 'head' ? 'hit_head' : 'hit', 0.8);
          this.fx.blood(_v1.set(e.fx, e.fy, e.fz), _v2.set(0, 0.2, 0), e.region === 'head' ? 14 : 8);
        } else if (e.victim === me) {
          const from = this.opponentEye();
          this.hud.damageFrom(this.angleTo(from));
          audio.ui('hurt', 0.9);
          this.flinch = Math.min(1, this.flinch + e.dmg / 60);
          if (e.kill) { audio.ui('death', 0.9); }
        } else {
          this.fx.blood(_v1.set(e.fx, e.fy, e.fz), _v2.set(0, 0.2, 0), 8);
        }
        return;
      }
      case 'thit': {
        const d = this.dummies.find((x) => x.id === e.id);
        const head = e.region === 'head';
        this.hud.hitMarker(e.kill ? 'kill' : head ? 'head' : 'hit');
        audio.ui(e.kill ? 'hit_kill' : head ? 'hit_head' : 'hit', 0.8);
        if (d) {
          const p = _v1.set(d.bar.position.x, d.bar.position.y - 0.4, d.bar.position.z);
          this.fx.blood(p, _v2.set(0, 0.3, 0), head ? 10 : 6, 0xc9c2b4);
          const sp = p.project(this.stage.camera);
          if (sp.z < 1) this.hud.damageNumber((sp.x * 0.5 + 0.5) * window.innerWidth, (-sp.y * 0.5 + 0.5) * window.innerHeight, String(e.dmg), e.kill ? 'kill' : head ? 'hs' : '');
        }
        this.practiceLast = `${e.region.toUpperCase()} −${e.dmg}${e.armorLoss ? ` (armor −${e.armorLoss})` : ''} · ${WEAPONS[e.w].name} · ${e.dist.toFixed(1)} m${e.kill ? ' · ELIMINATED' : ''}`;
        this.hud.practicePanel(true, this.practiceLast);
        return;
      }
      case 'kill': {
        const kname = this.nameOf(e.killer), vname = this.nameOf(e.victim);
        this.hud.killFeed(kname, vname, WEAPONS[e.w].name, !!e.head, e.killer === me, e.victim === me);
        if (e.victim === me) this.hud.deathMessage(`Eliminated by ${kname}`);
        return;
      }
      case 'live': this.phase = 'live'; this.prepBannerShown = false; this.hud.banner('Fight!', '', '#7dff9a'); audio.ui('go', 0.8); this.hud.showLoadout(false, this.loadout); return;
      case 'round': {
        const won = e.winner === me;
        const draw = e.winner < 0;
        this.hud.persistentBanner(draw ? (e.reason === 'double' ? 'Double knockout' : 'Time over') : won ? 'Round won' : 'Round lost',
          draw ? 'Draw — the round restarts, no point awarded' : `${this.nameOf(e.winner)} scores · ${e.sc[me]} : ${e.sc[1 - me]}`, draw ? '#ffcf6b' : won ? '#7dff9a' : '#ff6b6b');
        audio.ui(draw ? 'beep' : won ? 'win' : 'lose', 0.6);
        return;
      }
      case 'match': return;
      case 'step': { const p = _v1.set(e.x, e.y + 0.1, e.z); audio.step(e.surf, { x: p.x, y: p.y, z: p.z }, this.occluded(p)); return; }
      case 'jump': { audio.play('jump', { pos: { x: e.x, y: e.y + 0.1, z: e.z }, gain: 0.7, occluded: this.occluded(_v1.set(e.x, e.y + 1, e.z)) }); return; }
      case 'land': { audio.play('land', { pos: { x: e.x, y: e.y + 0.1, z: e.z }, gain: 0.9, occluded: this.occluded(_v1.set(e.x, e.y + 1, e.z)) }); return; }
      case 'reload': { this.opReloading = true; this.opReloadStart = performance.now(); this.opLastReloadProg = 0; return; }
      case 'switch': { const p = this.opChar?.root.position; if (p) audio.play('draw', { pos: { x: p.x, y: p.y + 1.2, z: p.z }, gain: 0.7 }); return; }
    }
  }

  private opponentEye(): THREE.Vector3 {
    const o = this.opChar?.root.position;
    return o ? _v3.set(o.x, o.y + 1.5, o.z) : _v3.set(0, 1.5, 0);
  }

  /** Angle (radians, clockwise on screen) from the view direction towards a world point. */
  private angleTo(p: THREE.Vector3): number {
    const cam = this.stage.camera.position;
    const dx = p.x - cam.x, dz = p.z - cam.z;
    const worldAng = Math.atan2(-dx, -dz); // same convention as yaw
    const rel = worldAng - (this.yaw + (this.pred?.punchYaw ?? 0) * DEG);
    return -rel;
  }

  private occluded(p: THREE.Vector3): boolean {
    const c = this.stage.camera.position;
    return !this.world.lineOfSight(c.x, c.y, c.z, p.x, p.y, p.z);
  }

  private remoteShot(e: Extract<GameEvent, { k: 'shot' }>): void {
    const def = WEAPONS[e.w];
    const origin = _v1.set(e.ox, e.oy, e.oz);
    const muzzle = this.opChar ? this.opChar.muzzleWorld(new THREE.Vector3()) : origin.clone();
    const end = new THREE.Vector3(e.ex, e.ey, e.ez);
    const cam = this.stage.camera.position;
    audio.shot(e.w, { x: e.ox, y: e.oy, z: e.oz }, this.occluded(origin), origin.distanceTo(cam));
    this.fx.tracer(muzzle, end, def.tracerColor);
    this.fx.muzzleFlash(muzzle, 1.1);
    if (this.opChar) { this.opChar.recoilKick(); }
    if (e.surf) {
      const n = new THREE.Vector3(e.nx, e.ny, e.nz);
      this.fx.impact(end, n, e.surf);
      audio.impact(e.surf, { x: end.x, y: end.y, z: end.z }, this.occluded(end));
    }
    // bullet passing close to the listener
    const a = muzzle, b = end;
    const ab = _v2.copy(b).sub(a); const len2 = ab.lengthSq();
    const t = clamp(len2 > 0 ? _v3.copy(cam).sub(a).dot(ab) / len2 : 0, 0, 1);
    const closest = a.clone().addScaledVector(ab, t);
    if (e.hit === 0 || closest.distanceTo(cam) > 0.4) { if (closest.distanceTo(cam) < 2.5 && t > 0.02 && t < 0.98) audio.whiz({ x: closest.x, y: closest.y, z: closest.z }); }
    // brass from the opponent's weapon
    if (this.opChar && (def.slot === 0 || def.id === 'deagle')) {
      const ej = this.opChar!.ejectWorld(new THREE.Vector3());
      const r = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.opChar!.root.rotation.y);
      this.fx.shell(ej, r, new THREE.Vector3(0, 1, 0), def.id === 'awp' ? 1.8 : 1);
    }
  }

  // ====================================================================== input -> commands
  private onKey(code: string): void {
    const b = settings.bindings;
    if (this.paused || !this.pred) return;
    if (code === b.slot1) this.wantSlot = 0;
    else if (code === b.slot2) this.wantSlot = 1;
    else if (code === b.lastWeapon) this.wantSlot = this.lastSlot;
    else if (code === b.scope) this.wantScope = true;
    else if (code === b.resetTargets && this.source === 'practice') { this.practice?.reset(); this.practiceLast = ''; this.hud.practicePanel(true, ''); this.fx.clearDecals(); }
    else if (code === b.toggleMinimap) this.hud.minimap.classList.toggle('hidden');
    else if (code === 'KeyB' && this.source === 'practice') { this.loadoutOpen = !this.loadoutOpen; this.hud.showLoadout(this.loadoutVisible(), this.loadout); }
    if (this.loadoutVisible()) {
      const k = ['Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].indexOf(code);
      if (k >= 0) { if (k < 4) this.setLoadout({ primary: PRIMARIES[k], pistol: this.loadout.pistol }); else this.setLoadout({ primary: this.loadout.primary, pistol: PISTOLS[k - 4] }); }
    }
  }

  private buildCmd(): Cmd {
    const ov = this.testOverride;
    let buttons = ov ? ov.buttons : this.input.buttons(settings.bindings);
    if (this.wantScope && !ov) buttons |= BTN.SCOPE;
    let slot = this.wantSlot;
    if (ov?.slot !== undefined) slot = ov.slot;
    const wheel = this.input.consumeWheel();
    if (wheel !== 0 && !ov) slot = this.pred ? (this.pred.weapon === 0 ? 1 : 0) : -1;
    if (slot >= 0 && this.pred && slot !== this.pred.weapon) this.lastSlot = this.pred.weapon;
    this.wantSlot = -1; this.wantScope = false;
    if (ov?.yaw !== undefined) this.yaw = ov.yaw;
    if (ov?.pitch !== undefined) this.pitch = ov.pitch;
    return { seq: ++this.seq, buttons, yaw: this.yaw, pitch: this.pitch, slot, rt: this.serverNow() - INTERP_DELAY_MS };
  }

  private fixedTick(): void {
    this.tickCount++;
    const sess = this.activeSession();
    if (!this.pred || !sess) { this.input.endTick(); return; }
    const cmd = this.buildCmd();
    this.prevPos.set(this.pred.x, this.pred.y, this.pred.z);
    this.pending.push(cmd);
    this.outbox.push(cmd);
    if (this.pending.length > 120) this.pending.shift();
    if (this.pred.alive) {
      const evs: SimEvent[] = [];
      const wasWeapon = this.pred.weapon;
      stepPlayer(this.pred, cmd, this.world, { frozen: this.phase === 'prep' }, evs);
      for (const e of evs) this.onLocalEvent(e);
      void wasWeapon;
    }
    if (this.tickCount % NET.clientSendEvery === 0 && this.outbox.length) {
      sess.sendCmds(this.epoch, this.outbox.splice(0, NET.maxCmdsPerMessage));
    }
    this.input.endTick();
  }

  private onLocalEvent(e: SimEvent): void {
    const p = this.pred!;
    switch (e.k) {
      case 'shot': this.localShot(e); break;
      case 'dry': audio.ui('dry', 0.7); break;
      case 'reload': this.lastReloadProg = 0; break;
      case 'reloadDone': break;
      case 'switch': audio.ui('draw', 0.7); this.vm.setWeapon(p.wids[p.weapon]); break;
      case 'step': audio.play('step_' + (e.surf === 'sand' ? 'sand' : e.surf === 'metal' ? 'metal' : e.surf === 'wood' ? 'wood' : 'stone'), { gain: 0.35 }); break;
      case 'jump': audio.play('jump', { gain: 0.5 }); break;
      case 'land': audio.play('land', { gain: 0.8 }); this.vm.onLand(e.speed); break;
    }
  }

  private viewToWorld(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const cam = this.stage.camera;
    const p = _v2.copy(v).project(this.stage.viewCamera);
    const dir = _v3.set(p.x, p.y, 0.5).unproject(cam).sub(cam.position).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const d = -v.z / Math.max(0.2, dir.dot(fwd));
    return out.copy(cam.position).addScaledVector(dir, d);
  }

  private localShot(e: Extract<SimEvent, { k: 'shot' }>): void {
    const def = WEAPONS[e.w];
    audio.shot(e.w);
    this.vm.onFire();
    // muzzle + impact prediction
    const muzzle = this.viewToWorld(this.vm.muzzleView, new THREE.Vector3());
    const hit = this.world.raycast(e.ox, e.oy, e.oz, e.dx, e.dy, e.dz, def.maxRange);
    const t = hit ? hit.t : 120;
    const end = new THREE.Vector3(e.ox + e.dx * t, e.oy + e.dy * t, e.oz + e.dz * t);
    // tracers are only drawn for a subset so the screen stays readable
    if (this.tickCount % 2 === 0 || def.rpm < 400) this.fx.tracer(muzzle, end, def.tracerColor);
    this.fx.muzzleFlash(muzzle.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.stage.camera.quaternion), 0.25), 0.7);
    if (hit) {
      this.fx.impact(end, new THREE.Vector3(hit.nx, hit.ny, hit.nz), hit.mat);
      audio.impact(hit.mat, { x: end.x, y: end.y, z: end.z });
    }
    // brass
    if (def.slot === 0 || def.id === 'deagle') {
      const eject = this.viewToWorld(this.vm.ejectView, new THREE.Vector3());
      const q = this.stage.camera.quaternion;
      this.fx.shell(eject, new THREE.Vector3(1, 0.2, 0.2).applyQuaternion(q), new THREE.Vector3(0, 1, 0), def.id === 'awp' ? 1.8 : 1);
    }
    this.shake = Math.min(1, this.shake + def.damage / 400);
  }

  // ====================================================================== frame
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!(dt > 0)) return;
    this.frameT0 = performance.now();
    this.frameMs.push(dt * 1000);
    if (this.frameMs.length > 600) { this.frameMs.shift(); this.logicMs.shift(); this.renderMs.shift(); }
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    dt = Math.min(dt, 0.25);

    // mouse look (every frame for low latency)
    const look = this.input.consumeLook();
    if (this.pred && !this.paused && this.pred.alive && !this.testOverride) {
      const def = currentWeapon(this.pred);
      const zoomFov = def.scope && this.pred.zoom > 0 ? def.scope.fovs[this.pred.zoom - 1] : settings.fov;
      const sensK = Math.tan(zoomFov * DEG / 2) / Math.tan(settings.fov * DEG / 2);
      const k = settings.sensitivity * 0.022 * DEG * sensK;
      this.yaw -= look.dx * k;
      this.pitch -= look.dy * k * (settings.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -89 * DEG, 89 * DEG);
      this.lookDX = look.dx * k; this.lookDY = look.dy * k;
    } else { this.lookDX = this.lookDY = 0; }

    // session pump + fixed tick
    this.activeSession()?.frame(dt);
    if (this.net && this.source !== 'net') this.net.frame(dt);
    if (!this.paused || this.testOverride) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 15) { this.fixedTick(); this.acc -= DT; n++; }
      if (n === 15) this.acc = 0;
    } else {
      // keep the sim ticking with neutral input so the server keeps acking (pointer unlocked / menu open)
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 15) { this.fixedTick(); this.acc -= DT; n++; }
      if (n === 15) this.acc = 0;
    }

    this.render(dt);
  }

  private interpolateOpponent(): { pose: OpponentSnap; alive: boolean } | null {
    const buf = this.oppBuf;
    if (this.source !== 'net' || buf.length === 0) return null;
    const rt = this.serverNow() - INTERP_DELAY_MS;
    let a = buf[0], b = buf[0];
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].st <= rt) { a = buf[i]; b = buf[Math.min(i + 1, buf.length - 1)]; }
    }
    if (rt < buf[0].st) { a = b = buf[0]; }
    const span = b.st - a.st;
    const k = span > 0 ? clamp((rt - a.st) / span, 0, 1) : 0;
    const A = a.op, B = b.op;
    const pose: OpponentSnap = {
      x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k), z: lerp(A.z, B.z, k),
      yaw: lerpAngle(A.yaw, B.yaw, k), pitch: lerp(A.pitch, B.pitch, k), crouch: lerp(A.crouch, B.crouch, k),
      vx: lerp(A.vx, B.vx, k), vz: lerp(A.vz, B.vz, k), ground: B.ground, alive: B.alive, wid: B.wid, reloading: B.reloading, zoom: B.zoom,
    };
    return { pose, alive: !!B.alive };
  }

  private render(dt: number): void {
    const stage = this.stage;
    const p = this.pred;
    const cam = stage.camera;

    // ---- decay reconcile error + flinch
    this.errOffset.multiplyScalar(Math.exp(-dt / 0.09));
    this.flinch *= Math.exp(-dt * 6);
    this.shake *= Math.exp(-dt * 12);

    if (p) {
      const alpha = clamp(this.acc / DT, 0, 1);
      const px = lerp(this.prevPos.x, p.x, alpha) + this.errOffset.x;
      const py = lerp(this.prevPos.y, p.y, alpha) + this.errOffset.y;
      const pz = lerp(this.prevPos.z, p.z, alpha) + this.errOffset.z;
      const def = currentWeapon(p);
      // death cam: sink and roll
      this.deadT = p.alive ? Math.max(0, this.deadT - dt * 4) : Math.min(1, this.deadT + dt * 1.8);
      const eye = eyeHeight(p.crouch) * (1 - this.deadT * 0.85);
      cam.position.set(px, py + eye, pz);
      const punchY = p.punchYaw * DEG, punchP = p.punchPitch * DEG;
      const viewYaw = this.yaw + punchY;
      const viewPitch = clamp(this.pitch + punchP - this.flinch * 0.03 + (Math.random() - 0.5) * this.shake * 0.002, -89.5 * DEG, 89.5 * DEG);
      cam.rotation.set(viewPitch, viewYaw, this.deadT * 0.5 * (this.mySlot ? -1 : 1), 'YXZ');
      // FOV (smoothed)
      const target = def.scope && p.zoom > 0 ? def.scope.fovs[p.zoom - 1] : settings.fov;
      this.fov += (target - this.fov) * Math.min(1, dt * 18);
      stage.setFov(this.fov);
      const scoped = !!(def.scope && p.zoom > 0);
      this.hud.scope(!!(scoped && this.fov < (def.scope!.fovs[0] + 4)));

      // viewmodel
      const speed = Math.hypot(p.vx, p.vz);
      this.vm.visible = !!p.alive && this.deadT < 0.05;
      this.vm.setWeapon(p.wids[p.weapon]);
      this.vm.update(dt, p, this.lookDX, this.lookDY, speed / (5.8 * def.moveSpeed), !!(scoped && this.fov < (def.scope!.fovs[0] + 4)));
      this.lookDX *= 0.5; this.lookDY *= 0.5;
      // view-space light: dim the viewmodel in shade
      stage.viewShade = this.world.raycast(cam.position.x, cam.position.y, cam.position.z, SUN_DIR.x, SUN_DIR.y, SUN_DIR.z, 40) ? 0.3 : 1;

      audio.setListener(cam.position, viewYaw, viewPitch);
      this.driveReloadSounds(p, def);
      this.updateHud(p, def, speed);
      if (this.source === 'practice') this.minimap.draw(px, pz, this.yaw);
      else this.minimap.draw(px, pz, this.yaw);
    }

    // ---- opponent
    const op = this.interpolateOpponent();
    if (op && this.source === 'net') {
      const opSlot = 1 - this.mySlot;
      if (!this.opChar || this.opCharSlot !== opSlot) {
        if (this.opChar) stage.scene.remove(this.opChar.root);
        this.opChar = new Character(TEAM_STYLES[opSlot]);
        this.opCharSlot = opSlot;
        stage.scene.add(this.opChar.root);
      }
      const o = op.pose;
      this.opChar.root.visible = true;
      this.opChar.update(dt, { x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch, crouch: o.crouch, vx: o.vx, vz: o.vz, ground: !!o.ground, alive: !!o.alive, wid: o.wid, reloading: !!o.reloading });
      this.driveOpponentReload(o);
    } else if (this.opChar) {
      this.opChar.root.visible = false;
    }

    // dummies face the camera bars
    for (const d of this.dummies) d.bar.quaternion.copy(cam.quaternion);

    this.fx?.update(dt);
    const tR = performance.now();
    this.logicMs.push(tR - this.frameT0);
    stage.render(dt);
    this.renderMs.push(performance.now() - tR);
  }

  private driveReloadSounds(p: PlayerState, def: ReturnType<typeof currentWeapon>): void {
    if (p.reloadT > 0) {
      const prog = 1 - p.reloadT / def.reloadTime;
      const marks: [number, string][] = def.id === 'awp' ? [[0.08, 'bolt'], [0.35, 'mag_out'], [0.62, 'mag_in'], [0.86, 'bolt']] : def.slot === 1 ? [[0.25, 'mag_out'], [0.6, 'mag_in'], [0.8, 'rack']] : [[0.2, 'mag_out'], [0.58, 'mag_in'], [0.82, 'rack']];
      for (const [t, name] of marks) if (this.lastReloadProg < t && prog >= t) audio.ui(name, 0.8);
      this.lastReloadProg = prog;
    } else this.lastReloadProg = 0;
  }

  private driveOpponentReload(o: OpponentSnap): void {
    if (!o.reloading) { this.opReloading = false; return; }
    if (!this.opReloading) { this.opReloading = true; this.opReloadStart = performance.now(); this.opLastReloadProg = 0; }
    const def = WEAPONS[o.wid];
    const prog = (performance.now() - this.opReloadStart) / 1000 / def.reloadTime;
    const marks: [number, string][] = [[0.2, 'mag_out'], [0.58, 'mag_in'], [0.82, 'rack']];
    const pos = this.opChar!.root.position;
    for (const [t, name] of marks) if (this.opLastReloadProg < t && prog >= t) audio.play(name, { pos: { x: pos.x, y: pos.y + 1.1, z: pos.z }, gain: 0.7, occluded: this.occluded(_v1.set(pos.x, pos.y + 1.2, pos.z)) });
    this.opLastReloadProg = prog;
  }

  private updateHud(p: PlayerState, def: ReturnType<typeof currentWeapon>, speed: number): void {
    const h = this.hud;
    h.setHealth(p.hp, p.armor);
    h.setAmmo(def.name, p.ammo[p.weapon], p.reserve[p.weapon], p.weapon, [WEAPONS[p.wids[0]].name, WEAPONS[p.wids[1]].name]);
    h.setReload(p.reloadT > 0 ? 1 - p.reloadT / def.reloadTime : 0);
    // crosshair: spread cone -> pixels
    const spreadRad = currentSpread(p) * DEG;
    const target = (Math.tan(spreadRad) / Math.tan(this.fov * DEG / 2)) * (window.innerHeight / 2);
    this.spreadPx += (Math.min(target, 140) - this.spreadPx) * 0.35;
    h.setSpread(this.spreadPx);
    h.crosshairVisible(!(def.scope && p.zoom > 0) && !!p.alive);
    // timer
    const elapsed = (performance.now() - this.phaseStamp) / 1000;
    const remaining = Math.max(0, this.phaseT - elapsed);
    if (this.source === 'practice') h.setTimer(0, 'Practice');
    else if (this.phase === 'prep') h.setTimer(remaining, `Round ${this.round} · get ready`);
    else if (this.phase === 'live') h.setTimer(remaining, `Round ${this.round}`);
    else if (this.phase === 'roundEnd') h.setTimer(0, `Round ${this.round}`);
    else if (this.phase === 'matchEnd') h.setTimer(0, 'Match over');
    else h.setTimer(0, 'Paused');
    if (this.phase === 'prep') { h.persistentBanner(`Round ${this.round}`, `Choose your weapons — starts in ${Math.ceil(remaining)}s`, '#ffffff'); this.prepBannerShown = true; }
    else if (this.prepBannerShown) { this.prepBannerShown = false; h.clearBanner(); }
    this.updateNet();
    // scoreboard
    const held = this.input.isDown(settings.bindings.scoreboard) || this.phase === 'matchEnd';
    if (held !== this.scoreboardHeld || held) {
      this.scoreboardHeld = held;
      this.renderScoreboard(held);
    }
  }
  private prepBannerShown = false;

  private renderScoreboard(show: boolean): void {
    if (!show) { this.hud.scoreboard(false); return; }
    if (this.source === 'net' && this.room) {
      const r = this.room;
      const rows = ([0, 1] as const).map((s) => { const pl = r.players[s]; return { name: pl?.name ?? '—', me: s === r.slot, score: pl?.score ?? 0, kills: pl?.kills ?? 0, deaths: pl?.deaths ?? 0, ping: s === r.slot ? Math.round(this.ping) : (pl?.ping ?? -1) }; });
      this.hud.scoreboard(true, rows, `First to ${r.cfg.winRounds} · Round ${r.round}`);
    } else {
      this.hud.scoreboard(true, [{ name: this.myName, me: true, score: 0, kills: 0, deaths: 0, ping: -1 }], 'Practice range');
    }
  }

  private updateNet(): void {
    const h = this.hud;
    const fps = settings.showFps ? ` · ${Math.round(this.fps)} fps` : '';
    if (!this.net) { h.setNet('Offline practice' + fps, -1, 'ok'); return; }
    const st = this.netStatus;
    if (st === 'open') {
      const ping = this.ping;
      h.setNet((this.source === 'net' ? 'Online' : 'Room open — waiting for friend') + fps, ping, ping < 80 ? 'ok' : ping < 160 ? 'mid' : 'bad');
    } else if (st === 'connecting') h.setNet('Connecting…' + fps, -1, 'mid');
    else if (st === 'reconnecting') h.setNet('Connection lost — reconnecting…' + fps, -1, 'bad');
    else h.setNet((this.netDetail || 'Disconnected') + fps, -1, 'bad');
  }

  // ====================================================================== test / benchmark helpers
  /** Returns average / percentile frame stats for the last N frames. */
  frameStats(): { avgMs: number; p95Ms: number; fps: number; frames: number; logicAvgMs: number; renderCallAvgMs: number } {
    const a = [...this.frameMs].sort((x, y) => x - y);
    if (!a.length) return { avgMs: 0, p95Ms: 0, fps: 0, frames: 0, logicAvgMs: 0, renderCallAvgMs: 0 };
    const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
    const avg = mean(a);
    return { avgMs: avg, p95Ms: a[Math.floor(a.length * 0.95)], fps: 1000 / avg, frames: a.length, logicAvgMs: mean(this.logicMs), renderCallAvgMs: mean(this.renderMs) };
  }
  debugState() {
    return {
      source: this.source, phase: this.phase, slot: this.mySlot, round: this.round, scores: this.scores, status: this.netStatus,
      pred: this.pred ? { x: this.pred.x, y: this.pred.y, z: this.pred.z, hp: this.pred.hp, armor: this.pred.armor, alive: this.pred.alive, ammo: this.pred.ammo, reserve: this.pred.reserve, weapon: this.pred.weapon, wids: this.pred.wids, reloadT: this.pred.reloadT, yaw: this.pred.yaw, vx: this.pred.vx, vz: this.pred.vz, crouch: this.pred.crouch, ground: this.pred.ground } : null,
      pending: this.pending.length, epoch: this.epoch, ping: this.ping, fps: this.fps,
      opp: this.opChar && this.opChar.root.visible ? { x: this.opChar.root.position.x, y: this.opChar.root.position.y, z: this.opChar.root.position.z } : null,
      room: this.room ? { phase: this.room.phase, players: this.room.players.map((q) => q && { name: q.name, connected: q.connected, score: q.score, kills: q.kills, deaths: q.deaths }) } : null,
      token: this.roomToken, errOffset: this.errOffset.length(), oppBuf: this.oppBuf.length,
    };
  }
}
