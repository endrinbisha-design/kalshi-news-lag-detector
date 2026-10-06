/**
 * Two-browser end-to-end test against a real server process.
 *   npm run build && npm run e2e
 * Drives two independent Chromium contexts (separate storage => separate identities), a third that must be rejected,
 * and verifies room flow, synchronised movement, firing, damage, death, scoring, round transitions, disconnect/reconnect,
 * rematch. Screenshots land in test-output/.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdirSync } from 'node:fs';
import { chromium, Page, BrowserContext } from 'playwright-core';
import { BTN } from '../src/shared/config';
import { findPath } from '../tests/bot';

const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function freePort(): Promise<number> { return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); }); }

const port = await freePort();
const lag = process.env.E2E_LAG ? Number(process.env.E2E_LAG) : 0;
const server = spawn('node', ['dist/server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PREP_TIME_SEC: '2', ROUND_TIME_SEC: '40', ROUND_END_SEC: '1.5', WIN_ROUNDS: '2', RECONNECT_GRACE_SEC: '60', QUIET: '1', ...(lag ? { SIM_LATENCY_MS: String(lag), SIM_JITTER_MS: String(Math.round(lag / 4)) } : {}) }, stdio: 'inherit' });
await sleep(1200);
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const allPages: { name: string; page: Page }[] = [];
const lowSettings = JSON.stringify({ preset: 'low', renderScale: 0.4, resolution: '960x540', volume: 0.1, name: '' });
async function newPlayer(ctx: BrowserContext, url: string, name: string): Promise<Page> {
  const page = await ctx.newPage();
  allPages.push({ name, page });
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message.slice(0, 300)));
  await page.addInitScript((s) => { try { if (!localStorage.getItem('courtyard-duel.settings.v1')) localStorage.setItem('courtyard-duel.settings.v1', s); } catch { /* ignore */ } }, lowSettings);
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__game?.loaded, null, { timeout: 120000 });
  return page;
}
const state = (p: Page) => p.evaluate(() => (window as any).__game.debugState());
const drive = (p: Page, o: { buttons: number; yaw?: number; pitch?: number; slot?: number } | null) => p.evaluate((x) => { (window as any).__game.testOverride = x; }, o);
async function waitState(p: Page, pred: (s: any) => boolean, ms = 20000, what = 'state') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await state(p); if (pred(s)) return s; await sleep(100); }
  throw new Error(`timeout: ${what}; last=${JSON.stringify(await state(p))}`);
}
async function walkTo(p: Page, target: { x: number; z: number }) {
  const s0 = await state(p);
  const path = findPath({ x: s0.pred.x, z: s0.pred.z }, target);
  if (!path.length) throw new Error('no path');
  for (let i = 1; i < path.length; ) {
    const s = await state(p);
    const w = path[i]; const dx = w.x - s.pred.x, dz = w.z - s.pred.z;
    if (Math.hypot(dx, dz) < (i === path.length - 1 ? 0.4 : 0.7)) { i++; continue; }
    await drive(p, { buttons: BTN.FWD, yaw: Math.atan2(-dx, -dz), pitch: 0 });
    await sleep(50);
  }
  await drive(p, { buttons: 0 });
}

try {
  const ctxA = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const ctxB = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const ctxC = await browser.newContext({ viewport: { width: 960, height: 540 } });

  // ---------------------------------------------------------------- room creation + invitation
  const A = await newPlayer(ctxA, base, 'A');
  await A.fill('#name-input', 'Alice');
  await A.click('#b-create');
  await A.waitForFunction(() => (document.querySelector('#link') as HTMLInputElement | null)?.value.includes('#r='), null, { timeout: 15000 });
  const link = await A.inputValue('#link');
  check('Alice creates a private room and gets an invite link', /#r=[A-Za-z0-9_-]{22}$/.test(link), link.replace(/#r=(.{4}).*/, '#r=$1…'));
  check('link uses the hash (token never sent in HTTP requests)', link.includes('#r=') && !link.includes('?'));
  await A.screenshot({ path: `${OUT}/01-lobby-link.png` });

  // Alice practises while waiting
  await A.evaluate(() => (window as any).__app.setScreen('none'));
  const sA0 = await waitState(A, (s) => s.source === 'practice' && !!s.pred, 15000, 'alice practice');
  check('Alice can practise solo while waiting', sA0.source === 'practice');
  await drive(A, { buttons: BTN.FIRE, yaw: -Math.PI / 2, pitch: 0 });
  await sleep(1200);
  await drive(A, null);
  const sA1 = await state(A);
  check('practice: firing consumes ammo on the predicted/authoritative state', sA1.pred.ammo[0] < 30, `ammo=${sA1.pred.ammo}`);

  // ---------------------------------------------------------------- Bob joins from a separate browser context
  const B = await newPlayer(ctxB, link, 'B');
  const joinVisible = await B.locator('#b-join').count();
  check('invite link opens the join screen', joinVisible === 1);
  await B.fill('#name-input', 'Bob');
  await B.click('#b-join');
  await B.waitForSelector('#b-go', { timeout: 15000 }).catch(() => {});
  await B.evaluate(() => (window as any).__app.setScreen('none'));
  await A.evaluate(() => (window as any).__app.setScreen('none'));
  const sA = await waitState(A, (s) => s.source === 'net' && (s.phase === 'prep' || s.phase === 'live') && !!s.pred, 30000, 'alice in match');
  const sB = await waitState(B, (s) => s.source === 'net' && (s.phase === 'prep' || s.phase === 'live') && !!s.pred, 30000, 'bob in match');
  check('both players enter a match', sA.source === 'net' && sB.source === 'net');
  check('players get different seats and opposite spawn sides', sA.slot !== sB.slot && Math.sign(sA.pred.x) === -Math.sign(sB.pred.x), `A x=${sA.pred.x.toFixed(1)} B x=${sB.pred.x.toFixed(1)}`);
  check('server names are exchanged', sA.room.players.map((p: any) => p.name).join() === 'Alice,Bob');

  // ---------------------------------------------------------------- two-player limit
  const C = await newPlayer(ctxC, link, 'C');
  await C.fill('#name-input', 'Mallory');
  await C.click('#b-join');
  await C.waitForFunction(() => document.body.innerText.includes('already has two players'), null, { timeout: 15000 }).catch(() => {});
  const cText = await C.evaluate(() => document.body.innerText);
  check('third player is rejected (room limited to two)', cText.includes('already has two players'));
  await C.screenshot({ path: `${OUT}/02-third-player-rejected.png` });
  await C.close();

  // ---------------------------------------------------------------- live round: movement sync
  await waitState(A, (s) => s.phase === 'live', 20000, 'live');
  await waitState(B, (s) => s.phase === 'live', 20000, 'live');
  await Promise.all([walkTo(A, { x: Math.sign((await state(A)).pred.x) * 14, z: -7 }), walkTo(B, { x: Math.sign((await state(B)).pred.x) * 14, z: -7 })]);
  await sleep(1200);
  const a1 = await state(A), b1 = await state(B);
  const seenByA = a1.opp, seenByB = b1.opp;
  check('movement is synchronised: each client renders the other at the server position (±0.6 m)',
    !!seenByA && !!seenByB && Math.hypot(seenByA.x - b1.pred.x, seenByA.z - b1.pred.z) < 0.6 && Math.hypot(seenByB.x - a1.pred.x, seenByB.z - a1.pred.z) < 0.6,
    `A sees B at (${seenByA?.x.toFixed(1)},${seenByA?.z.toFixed(1)}), B is at (${b1.pred.x.toFixed(1)},${b1.pred.z.toFixed(1)})`);
  await A.screenshot({ path: `${OUT}/03-alice-view-live.png` });
  await B.screenshot({ path: `${OUT}/04-bob-view-live.png` });

  // ---------------------------------------------------------------- weapon switching, reload, firing, damage, death
  await drive(A, { buttons: 0, slot: 1 });
  await sleep(300);
  await drive(A, { buttons: 0, slot: 0 });
  await sleep(300);
  await drive(A, { buttons: 0 });
  const a2 = await state(A);
  check('weapon switching works (pistol then back to primary)', a2.pred.weapon === 0);
  await drive(A, { buttons: BTN.RELOAD });
  await sleep(150);
  await drive(A, { buttons: 0 });
  const a3 = await state(A);
  check('reloading starts (only possible with a partially used mag; mag is full so it must not start)', a3.pred.reloadT === 0);

  const bHp0 = (await state(B)).pred.hp;
  const bSideBefore = Math.sign((await state(B)).pred.x);
  const epochBefore = (await state(A)).epoch;
  const t0 = Date.now();
  let killed = false;
  const scoresBefore = (await state(A)).scores.join(',');
  while (Date.now() - t0 < 20000) {
    const sa = await state(A), sb = await state(B);
    if (!sa.opp || sa.phase !== 'live') break;
    const dx = sa.opp.x - sa.pred.x, dz = sa.opp.z - sa.pred.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2((sa.opp.y + 1.3) - (sa.pred.y + 1.62), Math.hypot(dx, dz)) - 0.0;
    // spray with recoil compensation derived from the predicted state
    await drive(A, { buttons: BTN.FIRE, yaw, pitch });
    await sleep(60);
    if (sb.pred.hp < bHp0 && sb.pred.hp > 0 && !killed) { check('damage: server applies damage and both clients see it', sb.pred.hp < bHp0, `Bob hp ${bHp0}→${sb.pred.hp}`); killed = true; }
    if (!sb.pred.alive) break;
  }
  await drive(A, null);
  const bDead = await waitState(B, (s) => !s.pred.alive, 8000, 'bob dies');
  check('death: Bob is dead after being shot', !bDead.pred.alive);
  const sa = await waitState(A, (s) => s.phase === 'roundEnd' || s.phase === 'prep', 8000, 'round end');
  await B.screenshot({ path: `${OUT}/05-bob-after-death.png` });
  await A.screenshot({ path: `${OUT}/06-alice-round-won.png` });
  const sa2 = await waitState(A, (s) => s.epoch > epochBefore || s.phase === 'matchEnd', 25000, 'next round (A)');
  const sb2 = await waitState(B, (s) => s.epoch > epochBefore || s.phase === 'matchEnd', 25000, 'next round (B)');
  const scoreA = sa2.scores.join(',');
  check('score updated for the winner and synced to both players', scoreA !== scoresBefore && sb2.scores.join(',') === scoreA, `scores ${scoresBefore} → ${scoreA}`);
  check('round transition restarts with full health and swapped sides', sb2.epoch > epochBefore && sb2.pred.hp === 100 && sb2.pred.alive === 1 && Math.sign(sb2.pred.x) !== bSideBefore, `Bob x ${sb2.pred.x.toFixed(1)} (was side ${bSideBefore})`);

  // ---------------------------------------------------------------- disconnect + reconnect (same browser context => same identity)
  await B.close();
  const paused = await waitState(A, (s) => s.phase === 'paused', 15000, 'paused after disconnect');
  check('opponent disconnect is detected and the match pauses', paused.phase === 'paused');
  await A.screenshot({ path: `${OUT}/07-opponent-disconnected.png` });
  const B2 = await ctxB.newPage();
  await B2.addInitScript((s) => { try { if (!localStorage.getItem('courtyard-duel.settings.v1')) localStorage.setItem('courtyard-duel.settings.v1', s); } catch { /* ignore */ } }, lowSettings);
  await B2.goto(link);
  await B2.waitForFunction(() => (window as any).__game?.loaded, null, { timeout: 120000 });
  await B2.fill('#name-input', 'Bob');
  await B2.click('#b-join');
  await B2.evaluate(() => (window as any).__app.setScreen('none'));
  const resumed = await waitState(A, (s) => s.phase === 'prep' || (s.phase === 'live' && s.epoch > paused.epoch), 30000, 'resume after reconnect');
  const players = resumed.room.players.filter((p: any) => p && p.connected);
  check('reconnect resumes the match without duplicating the player', players.length === 2 && resumed.room.players.map((p: any) => p.name).join() === 'Alice,Bob', JSON.stringify(resumed.room.players.map((p: any) => p && [p.name, p.connected])));
  const sB3 = await waitState(B2, (s) => s.source === 'net' && (s.phase === 'prep' || s.phase === 'live') && !!s.pred, 30000, 'bob back');
  check('scores survive the reconnect', sB3.scores.join(',') === scoreA);

  // ---------------------------------------------------------------- finish the match (Alice wins again) and rematch
  async function winRound(shooter: Page, victim: Page) {
    await waitState(shooter, (s) => s.phase === 'live', 20000, 'live');
    await waitState(victim, (s) => s.phase === 'live', 20000, 'live');
    await Promise.all([shooter, victim].map(async (p) => walkTo(p, { x: Math.sign((await state(p)).pred.x) * 14, z: -7 })));
    const t = Date.now();
    while (Date.now() - t < 25000) {
      const s = await state(shooter);
      if (!s.opp || s.phase !== 'live') break;
      const dx = s.opp.x - s.pred.x, dz = s.opp.z - s.pred.z;
      await drive(shooter, { buttons: BTN.FIRE, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2((s.opp.y + 1.3) - (s.pred.y + 1.62), Math.hypot(dx, dz)) });
      await sleep(60);
    }
    await drive(shooter, null);
  }
  await winRound(A, B2);
  const end = await waitState(A, (s) => s.phase === 'matchEnd', 20000, 'match end');
  check('match ends when a player reaches the round-win target', end.scores.includes(2), `scores=${end.scores}`);
  await sleep(600);
  await A.evaluate(() => (window as any).__app.setScreen('result'));
  await A.screenshot({ path: `${OUT}/08-result-screen.png` });
  const resultText = await A.evaluate(() => document.body.innerText);
  check('victory screen with rematch button is shown', /VICTORY|DEFEAT/.test(resultText) && resultText.includes('Rematch'));
  await A.click('#b-rematch');
  await sleep(300);
  check('rematch waits for the opponent', (await state(A)).phase === 'matchEnd');
  await B2.evaluate(() => (window as any).__game.rematch());
  const rm = await waitState(A, (s) => s.phase === 'prep' || s.phase === 'live', 20000, 'rematch prep');
  check('rematch resets the score and starts a new match', rm.scores.join(',') === '0,0');
} catch (e) {
  check('e2e run completed without exceptions', false, (e as Error).stack?.split('\n').slice(0, 3).join(' | '));
  for (const { name, page } of allPages) { try { await page.screenshot({ path: `${OUT}/failure-${name}.png`, timeout: 5000 }); console.log(name, 'text:', (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, ' | ')); } catch { /* page closed */ } }
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
