import { Cmd } from '../shared/player';
import { MatchConfig, NET, DT } from '../shared/config';
import { MatchSim } from '../shared/match';
import { ClientMsg, PROTOCOL_VERSION, ServerMsg, encodeCmds } from '../shared/protocol';
import { playerSecret } from './settings';

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Common interface for the online WebSocket session and the in-page practice session. */
export interface Session {
  readonly kind: 'online' | 'practice';
  onMessage: (m: ServerMsg) => void;
  onStatus: (s: NetStatus, detail?: string) => void;
  sendCmds(ep: number, cmds: Cmd[]): void;
  sendLoadout(primary: string, pistol: string): void;
  rematch(): void;
  reset(): void;
  leave(): void;
  /** Called every rendered frame with real elapsed seconds (practice uses it to step the sim). */
  frame(dt: number): void;
  close(): void;
  rtt: number;
}

// ====================================================================== online
export interface OnlineOptions { create?: boolean; room?: string; name: string; lagMs?: number }

export class OnlineSession implements Session {
  readonly kind = 'online' as const;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus, detail?: string) => void = () => {};
  rtt = 0;
  room = '';
  private ws: WebSocket | null = null;
  private status: NetStatus = 'connecting';
  private tries = 0;
  private closedByUs = false;
  private pingTimer = 0;
  private reconnectTimer = 0;
  private joined = false;
  private secret = playerSecret();
  private lastCreateRoom: string | null = null;
  private lag: number;
  private lagQueue: { due: number; run: () => void }[] = [];
  private lagTimer = 0;

  constructor(private opts: OnlineOptions) {
    this.lag = opts.lagMs ?? 0;
    if (opts.room) this.room = opts.room;
    this.open();
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  private setStatus(s: NetStatus, detail?: string): void { this.status = s; this.onStatus(s, detail); }

  private open(): void {
    this.closedByUs = false;
    this.joined = false;
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch (e) { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      // first connection of a created room: create; afterwards (and for friends): join with the token
      if (!this.room && this.opts.create) this.raw({ t: 'create', name: this.opts.name, secret: this.secret, v: PROTOCOL_VERSION });
      else this.raw({ t: 'join', room: this.room, name: this.opts.name, secret: this.secret, v: PROTOCOL_VERSION });
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data as string); } catch { return; }
      const deliver = () => this.handle(m);
      if (this.lag > 0) this.delay(deliver); else deliver();
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      window.clearInterval(this.pingTimer);
      if (this.closedByUs) { this.setStatus('closed'); return; }
      if (ev.code === 4001) { this.setStatus('closed', 'This room was opened in another tab or window. Close the other one to play here.'); this.closedByUs = true; return; }
      if (ev.code === 1008 || ev.code === 1013) { this.setStatus('closed', 'Disconnected by the server (' + (ev.reason || 'rate limit') + ').'); return; }
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private delay(run: () => void): void {
    this.lagQueue.push({ due: performance.now() + this.lag + Math.random() * this.lag * 0.15, run });
    if (!this.lagTimer) this.lagTimer = window.setInterval(() => {
      const now = performance.now();
      while (this.lagQueue.length && this.lagQueue[0].due <= now) this.lagQueue.shift()!.run();
      if (!this.lagQueue.length) { clearInterval(this.lagTimer); this.lagTimer = 0; }
    }, 2);
  }

  private handle(m: ServerMsg): void {
    if (m.t === 'joined') {
      this.joined = true;
      this.room = m.room;
      this.setStatus('open');
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 1000);
      this.ping();
    } else if (m.t === 'err') {
      if (m.code === 'no_room' || m.code === 'full' || m.code === 'capacity' || m.code === 'rate') {
        this.closedByUs = true;
        this.ws?.close();
        this.setStatus('closed', m.msg);
      }
    } else if (m.t === 'pong') {
      const rtt = performance.now() - m.c;
      this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.7 + rtt * 0.3;
    }
    this.onMessage(m);
  }

  private scheduleReconnect(): void {
    if (this.closedByUs) return;
    if (!this.room && this.opts.create && !this.joined) { /* creation never succeeded: just retry creation */ }
    this.setStatus('reconnecting');
    this.tries++;
    const wait = Math.min(5000, 400 * 2 ** Math.min(this.tries, 4));
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.open(), wait);
  }

  private raw(m: ClientMsg): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(m);
    if (this.lag > 0) this.delay(() => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
    else ws.send(data);
  }

  private ping(): void { this.raw({ t: 'ping', c: performance.now(), rtt: Math.round(this.rtt) }); }
  sendCmds(ep: number, cmds: Cmd[]): void {
    if (!this.joined || !cmds.length) return;
    // wire format is positional arrays to keep packets tiny; the server validates it
    const ws = this.ws; if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify({ t: 'in', ep, c: encodeCmds(cmds) });
    if (this.lag > 0) this.delay(() => { if (ws.readyState === WebSocket.OPEN) ws.send(data); }); else ws.send(data);
  }
  sendLoadout(primary: string, pistol: string): void { this.raw({ t: 'loadout', primary, pistol } as ClientMsg); }
  rematch(): void { this.raw({ t: 'rematch' }); }
  reset(): void { /* practice only */ }
  leave(): void { this.raw({ t: 'leave' }); this.close(); }
  frame(): void {}
  close(): void {
    this.closedByUs = true;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.reconnectTimer);
    try { this.ws?.close(1000, 'bye'); } catch { /* ignore */ }
    this.setStatus('closed');
  }
}

// ====================================================================== practice (loopback)
/** Runs the very same authoritative simulation in the page: zero latency, no network, with resettable targets. */
export class PracticeSession implements Session {
  readonly kind = 'practice' as const;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};
  rtt = 0;
  private sim: MatchSim;
  private acc = 0;

  constructor(name: string, cfg: MatchConfig, loadout?: { primary: any; pistol: any }) {
    this.sim = new MatchSim({
      config: cfg, mode: 'practice',
      emit: (_slot, msg) => this.onMessage(msg as ServerMsg),
    });
    this.sim.connect(0, name || 'You');
    if (loadout) this.sim.setLoadout(0, loadout);
  }
  start(): void { this.onStatus('open'); this.onMessage({ t: 'joined', room: 'practice', slot: 0, time: this.sim.timeMs, v: PROTOCOL_VERSION }); }
  sendCmds(ep: number, cmds: Cmd[]): void { this.sim.input(0, ep, cmds); }
  sendLoadout(primary: string, pistol: string): void { this.sim.setLoadout(0, { primary: primary as any, pistol: pistol as any }); }
  rematch(): void {}
  reset(): void { this.sim.resetPractice(); }
  leave(): void {}
  frame(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= DT) { this.sim.step(); this.acc -= DT; }
  }
  close(): void {}
  get simTimeMs(): number { return this.sim.timeMs; }
}

export const INTERP_DELAY_MS = NET.interpDelayMs;
