/** Captures documentation screenshots from two real browsers (software GL; slow but deterministic). Output: docs/screenshots/ */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdirSync } from 'node:fs';
import { chromium, Page, BrowserContext } from 'playwright-core';
import { BTN } from '../src/shared/config';
import { findPath } from '../tests/bot';

const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const server = spawn('node', ['dist/server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PREP_TIME_SEC: '1', ROUND_TIME_SEC: '120', WIN_ROUNDS: '10', QUIET: '1' }, stdio: 'inherit' });
await sleep(1000);
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const settings = JSON.stringify({ preset: process.env.PRESET ?? 'medium', renderScale: 1, resolution: 'native', volume: 0, name: '' });
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 720);

async function open(ctx: BrowserContext, url: string): Promise<Page> {
  const p = await ctx.newPage();
  await p.addInitScript((s) => { try { if (!localStorage.getItem('courtyard-duel.settings.v1')) localStorage.setItem('courtyard-duel.settings.v1', s); } catch { /* */ } }, settings);
  await p.goto(url, { timeout: 240000, waitUntil: 'commit' });
  await p.waitForFunction(() => (window as any).__game?.loaded, null, { timeout: 180000 });
  return p;
}
const st = (p: Page) => p.evaluate(() => (window as any).__game.debugState());
const drive = (p: Page, o: any) => p.evaluate((x) => { (window as any).__game.testOverride = x; }, o);
async function until(p: Page, f: (s: any) => boolean, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const s = await st(p); if (f(s)) return s; await sleep(150); } throw new Error('timeout ' + JSON.stringify(await st(p)).slice(0, 400)); }
async function goTo(p: Page, target: { x: number; z: number }, faceYaw?: number) {
  const s0 = await st(p); const path = findPath({ x: s0.pred.x, z: s0.pred.z }, target);
  for (let i = 1; i < path.length;) {
    const s = await st(p); const w = path[i]; const dx = w.x - s.pred.x, dz = w.z - s.pred.z;
    if (Math.hypot(dx, dz) < (i === path.length - 1 ? 0.35 : 0.7)) { i++; continue; }
    await drive(p, { buttons: BTN.FWD, yaw: Math.atan2(-dx, -dz), pitch: 0 }); await sleep(60);
  }
  await drive(p, { buttons: 0, yaw: faceYaw ?? (await st(p)).pred.yaw });
}
const aimAt = async (from: Page, to: Page, extra: number, buttons = 0, pitchAdj = 0) => {
  const a = await st(from), b = await st(to);
  const dx = b.pred.x - a.pred.x, dz = b.pred.z - a.pred.z;
  await drive(from, { buttons, yaw: Math.atan2(-dx, -dz) + extra, pitch: Math.atan2((b.pred.y + 1.25) - (a.pred.y + 1.62), Math.hypot(dx, dz)) + pitchAdj });
};

try {
  const ctxA = await browser.newContext({ viewport: { width: W, height: H } });
  const ctxB = await browser.newContext({ viewport: { width: W, height: H } });
  // ---- menu + settings + practice
  const A = await open(ctxA, base);
  await A.screenshot({ path: `${OUT}/menu.png` });
  await A.fill('#name-input', 'Alice');
  await A.click('#b-settings'); await sleep(500);
  await A.screenshot({ path: `${OUT}/settings.png` });
  await A.click('.tabs button:nth-child(4)'); await sleep(300);
  await A.screenshot({ path: `${OUT}/settings-controls.png` });
  await A.click('.btnrow .primary'); await sleep(300);
  await A.click('#b-create');
  await A.waitForFunction(() => (document.querySelector('#link') as HTMLInputElement | null)?.value.includes('#r='), null, { timeout: 20000 });
  await A.screenshot({ path: `${OUT}/lobby-invite.png` });
  const link = await A.inputValue('#link');
  await A.evaluate(() => (window as any).__app.setScreen('none'));
  await until(A, (s) => s.source === 'practice' && !!s.pred);
  await drive(A, { buttons: 0, yaw: -Math.PI / 2 + 0.55, pitch: 0.0 });
  await sleep(1500);
  await A.screenshot({ path: `${OUT}/practice-range.png` });
  // ---- friend joins
  const B = await open(ctxB, link);
  await B.fill('#name-input', 'Bob'); await B.click('#b-join');
  await B.evaluate(() => (window as any).__app.setScreen('none')); await A.evaluate(() => (window as any).__app.setScreen('none'));
  await until(A, (s) => s.source === 'net' && s.phase === 'live', 90000); await until(B, (s) => s.source === 'net' && s.phase === 'live', 90000);
  await B.screenshot({ path: `${OUT}/prep-loadout.png` }).catch(() => {});
  // A: north lane west post, B: 4.5 m east of A, both facing each other
  await Promise.all([goTo(A, { x: -14, z: -7 }), goTo(B, { x: -9.5, z: -7 })]);
  await aimAt(A, B, 0); await aimAt(B, A, 0);
  await sleep(1500);
  await A.screenshot({ path: `${OUT}/opponent-closeup.png` });
  await B.screenshot({ path: `${OUT}/opponent-closeup-b.png` });
  // crouch + firing from A, captured on B's screen
  await drive(B, { buttons: BTN.CROUCH, yaw: (await st(B)).pred.yaw, pitch: 0 });
  for (let i = 0; i < 4; i++) { await aimAt(A, B, 0, BTN.FIRE, 0.02); await sleep(250); await B.screenshot({ path: `${OUT}/under-fire-${i}.png` }); }
  await drive(A, { buttons: 0 });
  await sleep(500);
  await A.screenshot({ path: `${OUT}/bullet-holes.png` });
  console.log('screens done');
} catch (e) {
  console.log('screens failed:', (e as Error).message);
} finally { await browser.close(); server.kill('SIGTERM'); }
