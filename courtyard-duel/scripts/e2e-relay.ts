/**
 * Two-tab test of the claude.ai-artifact relay mode, using scripts/mock-room.js in place of the platform's `room`
 * capability (BroadcastChannel between tabs + 60 ms one-way latency + the real 4 KiB presence cap).
 *   npm run build && npx tsx scripts/e2e-relay.ts
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { chromium, Page } from 'playwright-core';
import { BTN } from '../src/shared/config';
import { findPath } from '../tests/bot';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
// the static server only serves the client here: relay mode never opens a WebSocket
const server = spawn('node', ['dist/server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', QUIET: '1' }, stdio: 'inherit' });
await sleep(1000);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
await ctx.addInitScript({ content: readFileSync('scripts/mock-room.js', 'utf8') });
await ctx.addInitScript(() => { try { localStorage.setItem('courtyard-duel.settings.v1', JSON.stringify({ preset: 'low', renderScale: 0.4, volume: 0 })); } catch { /* */ } });
const url = `http://127.0.0.1:${port}/?mocklat=60`;
const open = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message)); await p.goto(url, { timeout: 240000, waitUntil: 'commit' }); await p.waitForFunction(() => (window as any).__game?.loaded, null, { timeout: 240000 }); return p; };
const st = (p: Page) => p.evaluate(() => (window as any).__game.debugState());
const drive = (p: Page, o: any) => p.evaluate((x) => { (window as any).__game.testOverride = x; }, o);
async function until(p: Page, f: (s: any) => boolean, ms = 60000, what = '') { const t = Date.now(); while (Date.now() - t < ms) { const s = await st(p); if (f(s)) return s; await sleep(150); } throw new Error('timeout ' + what + ' ' + JSON.stringify(await st(p)).slice(0, 300)); }
async function goTo(p: Page, target: { x: number; z: number }) {
  const s0 = await st(p); const path = findPath({ x: s0.pred.x, z: s0.pred.z }, target);
  for (let i = 1; i < path.length;) { const s = await st(p); const w = path[i]; const dx = w.x - s.pred.x, dz = w.z - s.pred.z; if (Math.hypot(dx, dz) < (i === path.length - 1 ? 0.4 : 0.7)) { i++; continue; } await drive(p, { buttons: BTN.FWD, yaw: Math.atan2(-dx, -dz), pitch: 0 }); await sleep(60); }
  await drive(p, { buttons: 0 });
}
try {
  const A = await open();
  const menuA = await A.evaluate(() => document.body.innerText);
  check('artifact mode detected (relay menu shown)', menuA.includes('Host a duel'));
  await A.fill('#name-input', 'Alice');
  await A.click('#b-host');
  await A.waitForFunction(() => document.body.innerText.includes('Your duel is open'), null, { timeout: 30000 });
  check('host opens a duel', true, (await A.evaluate(() => (window as any).__game.relayCode)));
  const B = await open();
  await B.fill('#name-input', 'Bob');
  await B.waitForFunction(() => document.body.innerText.includes("Alice's duel"), null, { timeout: 60000 });
  check('guest sees the open duel in the list', true);
  await B.click('#host-list button');
  await A.evaluate(() => (window as any).__app.setScreen('none')); await B.evaluate(() => (window as any).__app.setScreen('none'));
  const a = await until(A, (s) => s.source === 'net' && !!s.pred, 90000, 'host in match');
  const b = await until(B, (s) => s.source === 'net' && !!s.pred, 90000, 'guest in match');
  check('match starts on both tabs', true, `A x=${a.pred.x.toFixed(1)} B x=${b.pred.x.toFixed(1)}`);
  check('opposite spawn sides', Math.sign(a.pred.x) === -Math.sign(b.pred.x));
  await until(A, (s) => s.phase === 'live', 60000, 'live A'); await until(B, (s) => s.phase === 'live', 60000, 'live B');
  await Promise.all([goTo(A, { x: Math.sign((await st(A)).pred.x) * 14, z: -7 }), goTo(B, { x: Math.sign((await st(B)).pred.x) * 14, z: -7 })]);
  await sleep(1500);
  const a1 = await st(A), b1 = await st(B);
  check('movement synchronised both ways (±0.6 m)', !!a1.opp && !!b1.opp && Math.hypot(a1.opp.x - b1.pred.x, a1.opp.z - b1.pred.z) < 0.6 && Math.hypot(b1.opp.x - a1.pred.x, b1.opp.z - a1.pred.z) < 0.6,
    `A sees B ${a1.opp?.x.toFixed(2)},${a1.opp?.z.toFixed(2)} vs ${b1.pred.x.toFixed(2)},${b1.pred.z.toFixed(2)}; B sees A ${b1.opp?.x.toFixed(2)} vs ${a1.pred.x.toFixed(2)}`);
  // guest (through the relay) shoots the host
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const sb = await st(B); if (!sb.opp || sb.phase !== 'live') break;
    const dx = sb.opp.x - sb.pred.x, dz = sb.opp.z - sb.pred.z;
    await drive(B, { buttons: BTN.FIRE, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2((sb.opp.y + 1.3) - (sb.pred.y + 1.62), Math.hypot(dx, dz)) });
    await sleep(60);
  }
  await drive(B, null);
  const ae = await until(A, (s) => s.scores[1] === 1, 30000, 'guest scores');
  const be = await until(B, (s) => s.scores[1] === 1, 30000, 'guest sees score');
  check('guest kills host through the relay; both see score 0:1', ae.scores.join() === '0,1' && be.scores.join() === '0,1');
  const stats = await B.evaluate(() => (window as any).__mockRoomStats);
  const statsA = await A.evaluate(() => (window as any).__mockRoomStats);
  check('presence stays within the 4 KiB cap (no rejections)', statsA.rejected === 0 && stats.rejected === 0, `host max ${statsA.maxBytes} B, guest max ${stats.maxBytes} B`);
  check('ping measured on the guest', (await st(B)).ping > 0, `${Math.round((await st(B)).ping)} ms (mock latency 2×60 ms)`);
  await B.close();
  const p = await until(A, (s) => s.phase === 'paused', 30000, 'pause');
  check('guest leaving pauses the host match', p.phase === 'paused');
} catch (e) { check('relay e2e completed', false, (e as Error).message.slice(0, 400)); }
finally { await browser.close(); server.kill('SIGTERM'); }
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} relay checks passed`);
process.exit(failed ? 1 : 0);
