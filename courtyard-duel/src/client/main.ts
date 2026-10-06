import { PROTOCOL_VERSION } from '../shared/protocol';
import { audio } from './audio';
import { Game, GameHost } from './game';
import { NetStatus } from './net';
import { saveSettings, settings } from './settings';
import { buildSettings } from './ui/settingsUi';
import { RoomInfo } from '../shared/protocol';
import { RelayGuestSession, RelayHostSession, artifactRoom, isArtifactHost, watchHosts } from './relay';

/** Set when running inside a claude.ai artifact: multiplayer goes through the artifact's realtime room relay. */
let relayLobby: any = null;
let stopHostWatch: (() => void) | null = null;

type Screen = 'loading' | 'menu' | 'join' | 'lobby' | 'pause' | 'settings' | 'result' | 'error' | 'none';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud-root')!;
const uiRoot = document.getElementById('ui-root')!;

let screen: Screen = 'loading';
let settingsReturn: Screen = 'menu';
let resultInfo: { winner: number; slot: number; scores: [number, number]; names: [string, string] } | null = null;
let lastStatus: { s: NetStatus; d?: string } = { s: 'closed' };
let inviteToken = parseHash();
let lobbyRole: 'host' | 'guest' = 'host';

function parseHash(): string {
  const m = /[#&]r=([A-Za-z0-9_-]{22})/.exec(location.hash);
  if (m) return m[1];
  // a refreshed tab without the hash: offer to rejoin the room this browser was in
  try { const t = sessionStorage.getItem('courtyard-duel.room'); if (t && /^[A-Za-z0-9_-]{22}$/.test(t)) return t; } catch { /* ignore */ }
  return '';
}

const host: GameHost = {
  onStatus(s, d) {
    lastStatus = { s, d };
    if (s === 'closed' && d && game.inRoom) showError(d);
    refreshLive();
  },
  onRoom(r) { room = r; refreshLive(); },
  onLockChange(locked) {
    if (locked) { if (screen !== 'none') setScreen('none'); return; }
    // pointer released by Esc / alt-tab: show the pause screen unless another screen already took over
    if (screen === 'none') setScreen(resultInfo && game.currentPhase === 'matchEnd' ? 'result' : 'pause');
  },
  onMatchEnd(winner, slot, scores, names) {
    resultInfo = { winner, slot, scores, names };
    if (game.input.locked) game.input.unlock();
    setTimeout(() => { if (game.currentPhase === 'matchEnd' && screen !== 'settings') setScreen('result'); }, 150);
  },
  onMatchRestart() {
    if (resultInfo) { resultInfo = null; if (screen === 'result') setScreen('pause'); }
  },
};

let room: RoomInfo | null = null;
const game = new Game(canvas, hudRoot, host);
(window as any).__game = game;
(window as any).__audio = audio;

// ------------------------------------------------------------------ helpers
const h = (html: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

function nameValue(): string {
  const el = document.getElementById('name-input') as HTMLInputElement | null;
  const n = (el?.value ?? settings.name).trim().slice(0, 16);
  return n || 'Player' + Math.floor(Math.random() * 900 + 100);
}

function startLock(): void {
  audio.init();
  game.input.lock();
}

// ------------------------------------------------------------------ screens
function setScreen(s: Screen): void {
  screen = s;
  uiRoot.innerHTML = '';
  game.input.enabled = s === 'none';
  game.hud.show(s === 'none' || s === 'pause' || s === 'result' || s === 'lobby');
  if (s === 'none') return;
  const wrap = h('<div class="screen"></div>');
  const card = h('<div class="card"></div>');
  wrap.appendChild(card);
  uiRoot.appendChild(wrap);
  switch (s) {
    case 'loading': wrap.classList.add('solid'); renderLoading(card); break;
    case 'menu': wrap.classList.add('solid'); if (relayLobby) renderRelayMenu(card); else renderMenu(card); break;
    case 'join': wrap.classList.add('solid'); renderJoin(card); break;
    case 'lobby': renderLobby(card); break;
    case 'pause': renderPause(card); break;
    case 'settings': card.classList.add('wide'); buildSettings(card, game.input, () => setScreen(settingsReturn)); break;
    case 'result': renderResult(card); break;
    case 'error': renderError(card); break;
  }
}

function renderLoading(c: HTMLElement): void {
  c.innerHTML = `<h1>Courtyard <span>Duel</span></h1><p class="sub" id="load-msg">Loading arena textures and building the map…</p><div class="progress"><i id="load-bar"></i></div>`;
}

function controlsNote(): string {
  return `<div class="note"><b>Controls</b> · <kbd>W A S D</kbd> move · mouse aim · <kbd>Space</kbd> jump · <kbd>C</kbd> crouch · <kbd>Shift</kbd> walk (silent) · <kbd>R</kbd> reload · <kbd>1</kbd>/<kbd>2</kbd> weapons · <kbd>Tab</kbd> scoreboard · right-click scope (AWP) · <kbd>Esc</kbd> menu. Rebind in Settings.</div>`;
}

function renderRelayMenu(c: HTMLElement): void {
  c.innerHTML = `<h1>Courtyard <span>Duel</span></h1>
    <p class="sub">Private 1v1 tactical shooter. Host a duel, then your friend opens this same page and joins it. First to 10 rounds wins.</p>
    <div class="field"><label for="name-input">Display name</label><input id="name-input" type="text" maxlength="16" placeholder="Your name" autocomplete="off" value="${esc(settings.name)}"></div>
    <div class="btnrow"><button class="primary" id="b-host">Host a duel</button><button id="b-practice">Practice range (solo)</button></div>
    <div class="field" style="margin-top:20px"><label>Open duels on this page</label><div id="host-list" class="note">Looking for open duels…</div></div>
    <div class="err" id="menu-err"></div>
    <div class="btnrow"><button id="b-settings">Settings</button></div>
    <div class="note">Playing through claude.ai: the host's browser runs the match and your friend connects through claude.ai's realtime relay. Your friend needs this page shared with them (Share button at the top) and a claude.ai sign-in.</div>
    ${controlsNote()}`;
  const remember = () => { settings.name = nameValue(); saveSettings(); };
  c.querySelector('#b-host')!.addEventListener('click', () => {
    remember(); audio.init(); lobbyRole = 'host';
    game.startRelay(new RelayHostSession(relayLobby, settings.name), settings.name);
    setScreen('lobby');
  });
  c.querySelector('#b-practice')!.addEventListener('click', () => { remember(); if (game.inRoom) game.leaveRoom(); game.startPractice(settings.name); setScreen('none'); startLock(); });
  c.querySelector('#b-settings')!.addEventListener('click', () => { settingsReturn = 'menu'; setScreen('settings'); });
  const list = c.querySelector('#host-list') as HTMLElement;
  stopHostWatch?.();
  stopHostWatch = watchHosts(relayLobby, (hosts) => {
    if (!document.body.contains(list)) { stopHostWatch?.(); stopHostWatch = null; return; }
    list.innerHTML = hosts.length ? '' : 'No open duels yet. Ask your friend to click <b>Host a duel</b>, or host one yourself.';
    for (const h of hosts) {
      const row = document.createElement('div'); row.className = 'kb';
      const label = document.createElement('span'); label.textContent = `${h.name}'s duel (${h.code})`;
      const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Join';
      b.onclick = () => {
        remember(); audio.init(); lobbyRole = 'guest';
        game.startRelay(new RelayGuestSession(relayLobby, settings.name, h.code), settings.name);
        setScreen('lobby');
      };
      row.append(label, b); list.appendChild(row);
    }
  });
}

function renderMenu(c: HTMLElement): void {
  c.innerHTML = `<h1>Courtyard <span>Duel</span></h1>
    <p class="sub">Private 1v1 tactical shooter. Create a private room, send the link to a friend, first to ${room?.cfg.winRounds ?? 10} rounds wins. No install, no account.</p>
    <div class="field"><label for="name-input">Display name</label><input id="name-input" type="text" maxlength="16" placeholder="Your name" autocomplete="off" value="${esc(settings.name)}"></div>
    <div class="btnrow"><button class="primary" id="b-create">Create private room</button><button id="b-practice">Practice range (solo)</button></div>
    <div class="field" style="margin-top:20px"><label for="join-input">Have an invite link or code?</label>
      <div class="linkbox"><input id="join-input" type="text" placeholder="Paste invite link here" autocomplete="off"><button id="b-join">Join</button></div></div>
    <div class="err" id="menu-err"></div>
    <div class="btnrow"><button id="b-settings">Settings</button></div>
    ${controlsNote()}`;
  const err = c.querySelector('#menu-err') as HTMLElement;
  const remember = () => { settings.name = nameValue(); saveSettings(); };
  c.querySelector('#b-create')!.addEventListener('click', () => {
    remember(); audio.init();
    lobbyRole = 'host';
    game.startOnline({ create: true, name: settings.name, lagMs: Number(q.get('lag') ?? 0) });
    setScreen('lobby');
  });
  c.querySelector('#b-practice')!.addEventListener('click', () => {
    remember(); if (game.inRoom) game.leaveRoom(); game.startPractice(settings.name); setScreen('none'); startLock();
  });
  c.querySelector('#b-join')!.addEventListener('click', () => {
    const v = (c.querySelector('#join-input') as HTMLInputElement).value.trim();
    const m = /([A-Za-z0-9_-]{22})\s*$/.exec(v);
    if (!m) { err.textContent = 'That does not look like an invite link.'; return; }
    remember(); inviteToken = m[1]; err.textContent = '';
    joinNow();
  });
  c.querySelector('#b-settings')!.addEventListener('click', () => { settingsReturn = 'menu'; setScreen('settings'); });
}

function joinNow(): void {
  audio.init();
  lobbyRole = 'guest';
  game.startOnline({ room: inviteToken, name: settings.name, lagMs: Number(q.get('lag') ?? 0) });
  setScreen('lobby');
}

function renderJoin(c: HTMLElement): void {
  const rejoin = !!(() => { try { return sessionStorage.getItem('courtyard-duel.room') === inviteToken; } catch { return false; } })();
  c.innerHTML = `<h1>${rejoin ? 'Welcome back' : "You're invited"}</h1><p class="sub">${rejoin ? 'Your private duel room is still open. Rejoin to carry on where you left off (your seat is kept for you).' : 'A friend sent you a private duel room. Pick a name and jump in. First to 10 round wins.'}</p>
    <div class="field"><label for="name-input">Display name</label><input id="name-input" type="text" maxlength="16" placeholder="Your name" autocomplete="off" value="${esc(settings.name)}"></div>
    <div class="btnrow"><button class="primary" id="b-join">${rejoin ? 'Rejoin the duel' : 'Join the duel'}</button><button id="b-menu">Main menu</button></div>
    <div class="err" id="join-err"></div>${controlsNote()}`;
  c.querySelector('#b-join')!.addEventListener('click', () => { settings.name = nameValue(); saveSettings(); joinNow(); });
  c.querySelector('#b-menu')!.addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); try { sessionStorage.removeItem('courtyard-duel.room'); } catch { /* ignore */ } inviteToken = ''; setScreen('menu'); });
}

function renderLobby(c: HTMLElement): void {
  const st = lastStatus;
  const link = game.roomLink;
  const opp = room?.players[1 - (room?.slot ?? 0)];
  const oppHere = !!opp?.connected;
  const host_ = lobbyRole === 'host' || room?.slot === 0;
  const creating = !link && st.s !== 'closed';
  const title = oppHere ? 'Opponent connected' : host_ ? (creating ? 'Setting up your room…' : 'Private room ready') : (st.s === 'open' ? 'Joined the room' : 'Joining…');
  if (game.relayCode) {
    c.innerHTML = `<h2>${oppHere ? 'Opponent connected' : host_ ? 'Your duel is open' : (st.s === 'open' ? 'Joined' : 'Joining…')}</h2>
      ${oppHere ? `<p class="sub"><b>${esc(opp!.name)}</b> is here. Click below to start the match.</p><div class="btnrow"><button class="primary" id="b-go">Start match</button></div>`
        : host_ ? `<p class="sub">Duel code <b>${esc(game.relayCode)}</b>. Share this page with your friend (Share button at the top of the artifact). They open it, enter a name and click <b>Join</b> next to your name. Keep this tab in front while you play: your browser runs the match.</p>`
        : `<p class="sub">Connecting to the host through claude.ai…</p>`}
      <div class="note" id="lobby-status">${statusText()}</div>
      ${oppHere ? '' : `<div class="btnrow"><button id="b-practice">Practice while waiting</button><button class="warn" id="b-leave">${host_ ? 'Close duel' : 'Leave'}</button></div>`}
      <div class="err" id="lobby-err"></div>`;
    const go = () => { setScreen('none'); startLock(); };
    c.querySelector('#b-go')?.addEventListener('click', go);
    c.querySelector('#b-practice')?.addEventListener('click', go);
    c.querySelector('#b-leave')?.addEventListener('click', () => { game.leaveRoom(); setScreen('menu'); });
    return;
  }
  c.innerHTML = `<h2>${title}</h2>
    ${oppHere ? `<p class="sub"><b>${esc(opp!.name)}</b> is here. Click below to start the match.</p><div class="btnrow"><button class="primary" id="b-go">Start match</button></div>`
      : host_ ? `<p class="sub">Send this link to your friend. It is private: only people with the exact link can join, and only one other player fits.</p>
      <div class="linkbox"><input id="link" type="text" readonly value="${esc(link)}" placeholder="Creating room…"><button id="b-copy" class="primary" ${link ? '' : 'disabled'}>Copy link</button></div>
      <div class="note" id="lobby-status">${statusText()}</div>
      <div class="btnrow"><button id="b-practice">Practice while waiting</button><button class="warn" id="b-leave">Cancel room</button></div>
      <p class="note">While you practise nothing is scored. When your friend opens the link the match is announced here; click the screen once to start it.</p>`
      : `<p class="sub">Waiting for the host to be online…</p><div class="note" id="lobby-status">${statusText()}</div>
      <div class="btnrow"><button id="b-practice">Practice while waiting</button><button class="warn" id="b-leave">Leave</button></div>`}
    <div class="err" id="lobby-err"></div>`;
  c.querySelector('#b-copy')?.addEventListener('click', async (e) => {
    const ok = await copyText(game.roomLink); (e.target as HTMLElement).textContent = ok ? 'Copied ✓' : 'Select & copy manually';
    const inp = c.querySelector('#link') as HTMLInputElement; inp.select();
  });
  c.querySelector('#link')?.addEventListener('focus', (e) => (e.target as HTMLInputElement).select());
  const go = () => { setScreen('none'); startLock(); };
  c.querySelector('#b-go')?.addEventListener('click', go);
  c.querySelector('#b-practice')?.addEventListener('click', go);
  c.querySelector('#b-leave')?.addEventListener('click', () => { game.leaveRoom(); setScreen('menu'); });
}

function statusText(): string {
  const st = lastStatus;
  if (st.s === 'connecting') return 'Connecting to the server…';
  if (st.s === 'reconnecting') return 'Connection lost — retrying…';
  if (st.s === 'closed') return esc(st.d ?? 'Disconnected.');
  if (game.relayCode) return lobbyRole === 'host' ? 'Relay connected. Waiting for your friend to join…' : 'Connected to the host.';
  return 'Connected. Waiting for your friend to open the link…';
}

function renderPause(c: HTMLElement): void {
  const link = game.roomLink;
  const opp = room?.players[1 - (room?.slot ?? 0)];
  const inMatch = game.mode === 'duel';
  c.innerHTML = `<h2>${resultInfo ? 'Match finished' : inMatch ? 'Paused (the match keeps running)' : 'Paused'}</h2>
    ${game.inRoom ? `<div class="field"><label>Invite link</label><div class="linkbox"><input id="link" type="text" readonly value="${esc(link)}"><button id="b-copy" class="primary">Copy link</button></div></div>
      <div class="note" id="p-status">${esc(statusLine())}</div>` : ''}
    <div class="btnrow"><button class="primary" id="b-resume">Click to resume</button><button id="b-settings">Settings</button><button class="warn" id="b-leave">${game.inRoom ? 'Leave room' : 'Main menu'}</button></div>
    ${controlsNote()}`;
  void opp;
  c.querySelector('#b-resume')!.addEventListener('click', () => { setScreen('none'); startLock(); });
  c.querySelector('#b-settings')!.addEventListener('click', () => { settingsReturn = 'pause'; setScreen('settings'); });
  c.querySelector('#b-copy')?.addEventListener('click', async (e) => { const ok = await copyText(game.roomLink); (e.target as HTMLElement).textContent = ok ? 'Copied ✓' : 'Copy failed'; });
  c.querySelector('#b-leave')!.addEventListener('click', () => { if (game.inRoom) game.leaveRoom(); setScreen('menu'); });
}

function statusLine(): string {
  const opp = room?.players[1 - (room?.slot ?? 0)];
  if (!game.inRoom) return '';
  if (!opp || !opp.connected) return game.mode === 'duel' ? 'Opponent disconnected.' : 'Waiting for your friend to open the link…';
  return `Playing against ${opp.name}.`;
}

function renderResult(c: HTMLElement): void {
  if (!resultInfo) { setScreen('pause'); return; }
  const { winner, slot, scores, names } = resultInfo;
  const won = winner === slot;
  const me = room?.players[slot];
  const opp = room?.players[1 - slot];
  const canRematch = !!opp?.connected;
  c.innerHTML = `<div class="result"><div class="t ${won ? 'win' : 'lose'}">${won ? 'VICTORY' : 'DEFEAT'}</div>
    <div class="s mono">${esc(names[slot])} ${scores[slot]} : ${scores[1 - slot]} ${esc(names[1 - slot])}</div>
    <p class="sub">${won ? 'Nicely played.' : 'So close. Run it back?'}</p>
    <div class="btnrow"><button class="primary" id="b-rematch" ${canRematch && !me?.rematch ? '' : 'disabled'}>${me?.rematch ? 'Waiting for opponent…' : canRematch ? 'Rematch' : 'Opponent left'}</button><button class="warn" id="b-leave">Leave room</button></div>
    ${opp?.rematch ? '<div class="note">Your opponent wants a rematch.</div>' : ''}</div>`;
  c.querySelector('#b-rematch')!.addEventListener('click', () => { game.rematch(); });
  c.querySelector('#b-leave')!.addEventListener('click', () => { game.leaveRoom(); resultInfo = null; setScreen('menu'); });
}

function showError(msg: string): void {
  errorMsg = msg;
  if (screen !== 'error') setScreen('error');
}
let errorMsg = '';
function renderError(c: HTMLElement): void {
  c.innerHTML = `<h2>Can't join this room</h2><p class="sub">${esc(errorMsg)}</p><div class="btnrow"><button class="primary" id="b-menu">Back to menu</button></div>`;
  c.querySelector('#b-menu')!.addEventListener('click', () => { game.leaveRoom(); history.replaceState(null, '', location.pathname + location.search); inviteToken = ''; setScreen('menu'); });
}

/** Re-render dynamic screens when network / room info changes. */
function refreshLive(): void {
  if (screen === 'lobby') {
    const link = document.getElementById('link') as HTMLInputElement | null;
    const opp = room?.players[1 - (room?.slot ?? 0)];
    const isHost = lobbyRole === 'host' || room?.slot === 0;
    const needRebuild = (isHost && !link && !!game.roomLink) || (!!opp?.connected !== (uiRoot.querySelector('#b-go') !== null)) || (isHost && link && link.value !== game.roomLink);
    if (needRebuild) setScreen('lobby');
    else { const s = document.getElementById('lobby-status'); if (s) s.innerHTML = statusText(); }
  } else if (screen === 'result') {
    renderResultInPlace();
  } else if (screen === 'pause') {
    const s = document.getElementById('p-status'); if (s) s.textContent = statusLine();
  }
  if (lastStatus.s === 'closed' && lastStatus.d && screen === 'lobby') { const e = document.getElementById('lobby-err'); if (e) e.textContent = lastStatus.d; }
}
function renderResultInPlace(): void {
  const card = uiRoot.querySelector('.card') as HTMLElement | null;
  if (card) renderResult(card);
}

// ------------------------------------------------------------------ boot
async function boot(): Promise<void> {
  setScreen('loading');
  const bar = () => document.getElementById('load-bar') as HTMLElement | null;
  try {
    await game.load((f) => { const b = bar(); if (b) b.style.width = Math.round(f * 100) + '%'; });
  } catch (e) {
    console.error(e);
    const m = document.getElementById('load-msg'); if (m) m.textContent = 'Failed to load assets: ' + (e as Error).message + '. Is WebGL 2 enabled in your browser?';
    return;
  }
  game.startPractice(settings.name || 'You'); // idle backdrop behind menus
  if (isArtifactHost()) { relayLobby = await artifactRoom(); inviteToken = ''; }
  window.addEventListener('hashchange', () => { inviteToken = parseHash(); });
  if (q.get('autostart') === 'practice') { setScreen('none'); (window as any).__skipLock = true; return; }
  setScreen(inviteToken ? 'join' : 'menu');
}

// ------------------------------------------------------------------ URL overrides + benchmark (testing / measuring)
function applyUrlOverrides(): void {
  const p = q.get('preset'); if (p === 'low' || p === 'medium' || p === 'high') settings.preset = p;
  const sc = Number(q.get('scale')); if (sc >= 0.25 && sc <= 1) settings.renderScale = sc;
  const res = q.get('res'); if (res && /^\d+x\d+$/.test(res)) settings.resolution = res as any;
  if (q.get('fps')) settings.showFps = true;
}

/** 10 s scripted fly-through in the practice range: walking, turning, firing (effects on), then reports frame times. */
async function runBenchmark(seconds: number): Promise<void> {
  game.startPractice('bench');
  setScreen('none');
  await new Promise((r) => setTimeout(r, 1200));
  game.frameMs.length = 0;
  const t0 = performance.now();
  let n = 0;
  await new Promise<void>((resolve) => {
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) { resolve(); return; }
      const fire = Math.floor(t * 2) % 2 === 0;
      game.testOverride = { buttons: (Math.floor(t / 2.5) % 2 === 0 ? 1 : 0) | (fire ? 128 : 0), yaw: -Math.PI / 2 + Math.sin(t * 0.7) * 1.4, pitch: Math.sin(t * 1.3) * 0.12 };
      n++;
      requestAnimationFrame(step);
    };
    step();
  });
  game.testOverride = null;
  const st = game.frameStats();
  const info = {
    ...st, seconds, preset: settings.preset, renderScale: settings.renderScale, resolution: settings.resolution,
    internal: [game.stage.internalW, game.stage.internalH], drawCalls: game.stage.renderer.info.render.calls, triangles: game.stage.renderer.info.render.triangles, geometries: game.stage.renderer.info.memory.geometries, textures: game.stage.renderer.info.memory.textures,
    gpu: (() => { try { const gl = game.stage.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; } catch { return 'unknown'; } })(),
    userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, frames: n,
  };
  (window as any).__bench = info;
  console.log('[bench] ' + JSON.stringify(info));
}

(window as any).__app = { setScreen, startLock, version: PROTOCOL_VERSION, host, runBenchmark };
applyUrlOverrides();
void boot().then(() => { if (q.get('bench')) void runBenchmark(Number(q.get('bench')) > 1 ? Number(q.get('bench')) : 10); });
