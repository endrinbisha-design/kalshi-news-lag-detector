import { PISTOLS, PRIMARIES, WEAPONS, WeaponId } from '../../shared/config';
import { Settings } from '../settings';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface ScoreRow { name: string; me: boolean; score: number; kills: number; deaths: number; ping: number }

/** All in-game overlay elements (DOM). Pure presentation: the Game pushes values in. */
export class Hud {
  readonly root: HTMLElement;
  private top = el('div', '');
  private nmMe!: HTMLElement; private nmOp!: HTMLElement; private scMe!: HTMLElement; private scOp!: HTMLElement;
  private tm!: HTMLElement; private rd!: HTMLElement;
  private kf = el('div'); private cross = el('div'); private hm = el('div'); private ddirs = el('div'); private vig = el('div');
  private hp!: HTMLElement; private hpBar!: HTMLElement; private ar!: HTMLElement; private arBar!: HTMLElement; private hpStat!: HTMLElement;
  private wn!: HTMLElement; private am!: HTMLElement; private slots!: HTMLElement;
  private reload = el('div'); private reloadI = el('i');
  private bannerEl = el('div'); private scopeEl = el('div'); private netbox = el('div'); private invite = el('div');
  private sb = el('div'); private loadout = el('div'); private practice = el('div'); private bigmsg = el('div'); private deathmsg = el('div');
  readonly minimap = el('canvas');
  private hmTimer = 0; private bannerTimer = 0;
  private lastLoadoutKey = '';
  onPickLoadout: (primary: WeaponId, pistol: WeaponId) => void = () => {};
  private lo = { primary: 'ak47' as WeaponId, pistol: 'glock' as WeaponId };

  constructor(root: HTMLElement) {
    this.root = el('div', 'hud hidden');
    root.appendChild(this.root);
    const r = this.root;

    this.top.id = 'topbar';
    this.top.innerHTML = `<div class="team me"><div class="nm" id="nm-me">You</div><div class="sc mono" id="sc-me">0</div></div>
      <div class="mid"><div class="tm mono" id="tm">1:30</div><div class="rd" id="rd">Round 1</div></div>
      <div class="team op"><div class="nm" id="nm-op">Opponent</div><div class="sc mono" id="sc-op">0</div></div>`;
    r.appendChild(this.top);
    this.nmMe = this.top.querySelector('#nm-me')!; this.nmOp = this.top.querySelector('#nm-op')!;
    this.scMe = this.top.querySelector('#sc-me')!; this.scOp = this.top.querySelector('#sc-op')!;
    this.tm = this.top.querySelector('#tm')!; this.rd = this.top.querySelector('#rd')!;

    this.kf.id = 'killfeed'; r.appendChild(this.kf);
    this.cross.id = 'crosshair';
    this.cross.innerHTML = '<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i>';
    r.appendChild(this.cross);
    this.hm.id = 'hitmarker'; this.hm.innerHTML = '<i></i><i></i><i></i><i></i>'; r.appendChild(this.hm);
    this.ddirs.id = 'damage-dirs'; r.appendChild(this.ddirs);
    this.vig.id = 'vignette'; r.appendChild(this.vig);

    const bl = el('div'); bl.id = 'bottom-left';
    bl.innerHTML = `<div class="stat" id="st-hp"><svg class="ic" viewBox="0 0 24 24" fill="#7dff9a"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg><div><div class="v mono" id="hp">100</div><div class="bar"><i id="hp-bar" style="width:100%"></i></div></div></div>
      <div class="stat armor"><svg class="ic" viewBox="0 0 24 24" fill="#6fa8ff"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z"/></svg><div><div class="v mono" id="ar">100</div><div class="bar"><i id="ar-bar" style="width:100%"></i></div></div></div>`;
    r.appendChild(bl);
    this.hp = bl.querySelector('#hp')!; this.hpBar = bl.querySelector('#hp-bar')!; this.ar = bl.querySelector('#ar')!; this.arBar = bl.querySelector('#ar-bar')!; this.hpStat = bl.querySelector('#st-hp')!;

    const br = el('div'); br.id = 'bottom-right';
    br.innerHTML = '<div class="wn" id="wn">AK-47</div><div class="am mono" id="am">30<small>/ 90</small></div><div class="slots" id="slots"></div>';
    r.appendChild(br);
    this.wn = br.querySelector('#wn')!; this.am = br.querySelector('#am')!; this.slots = br.querySelector('#slots')!;

    this.reload.id = 'reload-bar'; this.reload.appendChild(this.reloadI); r.appendChild(this.reload);
    this.bannerEl.id = 'banner'; r.appendChild(this.bannerEl);
    this.scopeEl.id = 'scope'; this.scopeEl.innerHTML = '<div class="dotc"></div>'; this.scopeEl.classList.add('hidden'); r.appendChild(this.scopeEl);
    this.netbox.id = 'netbox'; r.appendChild(this.netbox);
    this.minimap.id = 'minimap'; this.minimap.width = 380; this.minimap.height = 196; r.appendChild(this.minimap);
    this.invite.id = 'invitebar'; this.invite.classList.add('hidden'); r.appendChild(this.invite);
    this.sb.id = 'scoreboard'; this.sb.classList.add('hidden'); r.appendChild(this.sb);
    this.loadout.id = 'loadout'; this.loadout.classList.add('hidden'); r.appendChild(this.loadout);
    this.practice.id = 'practice-panel'; this.practice.classList.add('hidden'); r.appendChild(this.practice);
    this.bigmsg.id = 'bigmsg'; this.bigmsg.classList.add('hidden'); r.appendChild(this.bigmsg);
    this.deathmsg.id = 'deathmsg'; this.deathmsg.classList.add('hidden'); r.appendChild(this.deathmsg);
  }

  show(v: boolean): void { this.root.classList.toggle('hidden', !v); }

  applySettings(s: Settings): void {
    const c = this.cross;
    c.style.setProperty('--ch-color', s.crosshair.color);
    (c.querySelector('.dot') as HTMLElement).style.display = s.crosshair.dot ? 'block' : 'none';
    this.minimap.classList.toggle('hidden', false);
    this.crosshairShape = s.crosshair;
    this.setSpread(this.lastSpread);
  }
  private crosshairShape = { size: 6, gap: 3, thickness: 2 } as { size: number; gap: number; thickness: number };
  private lastSpread = 0;

  /** spreadPx: how far the arms sit from the centre because of inaccuracy. */
  setSpread(spreadPx: number): void {
    this.lastSpread = spreadPx;
    const { size, gap, thickness } = this.crosshairShape;
    const g = gap + spreadPx, t = thickness, L = size;
    const set = (cls: string, w: number, h: number, x: number, y: number) => { const e = this.cross.querySelector('.' + cls) as HTMLElement; e.style.width = w + 'px'; e.style.height = h + 'px'; e.style.left = x + 'px'; e.style.top = y + 'px'; };
    set('t', t, L, -t / 2, -g - L); set('b', t, L, -t / 2, g); set('l', L, t, -g - L, -t / 2); set('r', L, t, g, -t / 2);
  }
  crosshairVisible(v: boolean): void { this.cross.style.display = v ? 'block' : 'none'; }

  setNames(me: string, op: string): void { this.nmMe.textContent = me; this.nmOp.textContent = op; }
  setScore(me: number, op: number): void { this.scMe.textContent = String(me); this.scOp.textContent = String(op); }
  setTimer(sec: number, label: string): void {
    const s = Math.max(0, Math.ceil(sec));
    this.tm.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.tm.classList.toggle('low', sec <= 10 && sec > 0);
    this.rd.textContent = label;
  }
  setHealth(hp: number, armor: number): void {
    this.hp.textContent = String(Math.max(0, Math.round(hp))); this.hpBar.style.width = Math.max(0, hp) + '%';
    this.ar.textContent = String(Math.round(armor)); this.arBar.style.width = armor + '%';
    this.hpStat.classList.toggle('low', hp <= 30);
  }
  setAmmo(name: string, mag: number, reserve: number, slot: number, names: [string, string]): void {
    this.wn.textContent = name;
    this.am.innerHTML = `${mag}<small>/ ${reserve}</small>`;
    this.am.classList.toggle('empty', mag === 0);
    this.slots.innerHTML = names.map((n, i) => `<span class="${i === slot ? 'on' : ''}">${i + 1} ${esc(n)}</span>`).join('');
  }
  setReload(f: number): void { this.reload.style.display = f > 0 ? 'block' : 'none'; this.reloadI.style.width = Math.round(f * 100) + '%'; }

  hitMarker(kind: 'hit' | 'head' | 'kill'): void {
    this.hm.className = kind === 'head' ? 'hs' : kind === 'kill' ? 'kill' : '';
    this.hm.style.opacity = '1';
    window.clearTimeout(this.hmTimer);
    this.hmTimer = window.setTimeout(() => { this.hm.style.opacity = '0'; }, 140);
  }

  damageFrom(angle: number): void {
    const d = el('div', 'ddir');
    d.style.transform = `rotate(${angle}rad)`;
    this.ddirs.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = '1'; requestAnimationFrame(() => { d.style.transitionDuration = '1.1s'; d.style.opacity = '0'; }); });
    window.setTimeout(() => d.remove(), 1500);
    this.vig.style.transition = 'none'; this.vig.style.opacity = '0.8';
    requestAnimationFrame(() => { this.vig.style.transition = 'opacity .6s ease-out'; this.vig.style.opacity = '0'; });
  }

  killFeed(killer: string, victim: string, weapon: string, head: boolean, meKiller: boolean, meVictim: boolean): void {
    const e = el('div', 'kf');
    e.innerHTML = `<b class="${meKiller ? 'me' : 'op'}">${esc(killer)}</b><span class="w">${esc(weapon)}</span>${head ? '<span class="hs">⌖ HS</span>' : ''}<b class="${meVictim ? 'me' : 'op'}">${esc(victim)}</b>`;
    this.kf.appendChild(e);
    window.setTimeout(() => e.remove(), 6000);
    while (this.kf.children.length > 5) this.kf.firstElementChild!.remove();
  }

  banner(big: string, small = '', color = '#fff'): void {
    this.bannerEl.className = '';
    void this.bannerEl.offsetWidth;
    this.bannerEl.innerHTML = `<div class="big" style="color:${color}">${esc(big)}</div><div class="small">${esc(small)}</div>`;
    this.bannerEl.classList.add('fade');
    window.clearTimeout(this.bannerTimer);
  }
  persistentBanner(big: string, small = '', color = '#fff'): void {
    this.bannerEl.className = '';
    this.bannerEl.innerHTML = `<div class="big" style="color:${color}">${esc(big)}</div><div class="small">${esc(small)}</div>`;
  }
  clearBanner(): void { this.bannerEl.className = ''; this.bannerEl.innerHTML = ''; }

  scope(on: boolean, radiusVh = 42): void {
    this.scopeEl.classList.toggle('hidden', !on);
    if (on) this.scopeEl.style.setProperty('--r', radiusVh + 'vh');
  }

  setNet(text: string, ping: number, quality: 'ok' | 'mid' | 'bad', extra = ''): void {
    this.netbox.innerHTML = `<span class="dot ${quality === 'ok' ? '' : quality}"></span>${esc(text)}${ping >= 0 ? ` · <span class="mono">${Math.round(ping)} ms</span>` : ''}${extra ? `<br>${extra}` : ''}`;
  }
  setInvite(html: string | null): void {
    this.invite.classList.toggle('hidden', !html);
    if (html) this.invite.innerHTML = html;
  }

  scoreboard(show: boolean, rows: ScoreRow[] = [], title = ''): void {
    this.sb.classList.toggle('hidden', !show);
    if (!show) return;
    this.sb.innerHTML = `<h3>${esc(title)}</h3><table><tr><th>Player</th><th>Rounds</th><th>Kills</th><th>Deaths</th><th>Ping</th></tr>${rows.map((r) => `<tr class="${r.me ? 'me' : ''}"><td>${esc(r.name)}</td><td class="mono">${r.score}</td><td class="mono">${r.kills}</td><td class="mono">${r.deaths}</td><td class="mono">${r.ping >= 0 ? r.ping : '–'}</td></tr>`).join('')}</table>`;
  }

  showLoadout(show: boolean, current: { primary: WeaponId; pistol: WeaponId }): void {
    this.loadout.classList.toggle('hidden', !show);
    if (!show) { this.lastLoadoutKey = ''; return; }
    const key = current.primary + current.pistol;
    if (key === this.lastLoadoutKey) return;
    this.lastLoadoutKey = key;
    this.lo = { ...current };
    const card = (id: WeaponId, k: string, on: boolean) => {
      const w = WEAPONS[id];
      return `<div class="wcard ${on ? 'on' : ''}" data-id="${id}"><kbd>${k}</kbd><b>${w.name}</b>DMG ${w.damage} · ${w.rpm} rpm<br>${w.magSize} rnd · ${w.reloadTime.toFixed(1)}s reload</div>`;
    };
    this.loadout.innerHTML = `<div><h4>Primary</h4><div class="row">${PRIMARIES.map((id, i) => card(id, String(i + 3), id === current.primary)).join('')}</div></div>
      <div><h4>Pistol</h4><div class="row">${PISTOLS.map((id, i) => card(id, String(i + 7), id === current.pistol)).join('')}</div></div>`;
    this.loadout.querySelectorAll<HTMLElement>('.wcard').forEach((c) => c.addEventListener('click', () => {
      const id = c.dataset.id as WeaponId;
      if (WEAPONS[id].slot === 0) this.onPickLoadout(id, this.lo.pistol); else this.onPickLoadout(this.lo.primary, id);
    }));
  }

  practicePanel(show: boolean, last = ''): void {
    this.practice.classList.toggle('hidden', !show);
    if (!show) return;
    this.practice.innerHTML = `<h4>Practice range</h4><div class="last">${last || 'Shoot the dummies. Head ×4, chest ×1, stomach ×1.25, legs ×0.75.'}</div>
      <div>Reset targets &amp; ammo: <kbd>T</kbd> · Loadout menu: <kbd>B</kbd> then <kbd>3</kbd>–<kbd>8</kbd></div>`;
  }

  bigMessage(title: string | null, body = ''): void {
    this.bigmsg.classList.toggle('hidden', !title);
    if (title) this.bigmsg.innerHTML = `<h2>${esc(title)}</h2><p>${body}</p>`;
  }
  deathMessage(text: string | null): void {
    this.deathmsg.classList.toggle('hidden', !text);
    if (text) this.deathmsg.textContent = text;
  }

  /** Floating damage number at a screen position (CSS px). */
  damageNumber(x: number, y: number, text: string, cls = ''): void {
    const e = el('div', 'dmgnum ' + cls, esc(text));
    e.style.left = x + 'px'; e.style.top = y + 'px';
    this.root.appendChild(e);
    requestAnimationFrame(() => { e.style.transform = 'translate(-50%, -140%)'; e.style.opacity = '0'; });
    window.setTimeout(() => e.remove(), 900);
  }
}
