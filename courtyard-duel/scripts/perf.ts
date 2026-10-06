/**
 * Frame-time benchmark: loads the built game in headless Chromium and runs the in-game fly-through (`?bench=N`)
 * for each preset. In CI / containers WebGL is CPU software rendering (SwiftShader), so these numbers are a worst-case floor,
 * NOT a prediction for a laptop GPU. Run it on your own machine (with a real GPU: pass CHROME=/path/to/chrome) to measure yours.
 *   npm run build && npm run perf            # optional env: RES=1920x1080 SECS=8 PRESETS=low,medium,high HEADFUL=1
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { chromium } from 'playwright-core';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const server = spawn('node', ['dist/server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', QUIET: '1' }, stdio: 'inherit' });
await sleep(1000);

const [W, H] = (process.env.RES ?? '1920x1080').split('x').map(Number);
const secs = Number(process.env.SECS ?? 8);
const presets = (process.env.PRESETS ?? 'low,medium,high').split(',');
const scales = (process.env.SCALES ?? '1').split(',').map(Number);
const useGpu = !!process.env.GPU;
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: !process.env.HEADFUL,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', ...(useGpu ? ['--use-gl=angle'] : ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'])],
});
const rows: any[] = [];
for (const preset of presets) for (const scale of scales) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`http://127.0.0.1:${port}/?preset=${preset}&scale=${scale}&bench=${secs}`);
  await page.waitForFunction(() => (window as any).__bench, null, { timeout: 300000 });
  const b = await page.evaluate(() => (window as any).__bench);
  rows.push({ preset, scale, internal: b.internal.join('×'), avgFps: +b.fps.toFixed(1), avgMs: +b.avgMs.toFixed(1), p95Ms: +b.p95Ms.toFixed(1), logicMs: +b.logicAvgMs.toFixed(2), renderCallMs: +b.renderCallAvgMs.toFixed(1), frames: b.frames, drawCalls: b.drawCalls, tris: b.triangles, gpu: b.gpu.replace(/ANGLE \(Google, Vulkan [\d.]+ \(|\).*/g, '') });
  await page.close();
}
console.log(`\nTest environment: ${os.cpus()[0].model} × ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM, ${os.platform()} ${os.release()}, node ${process.version}`);
console.log(`Viewport ${W}×${H}, bench ${secs}s per preset\n`);
console.table(rows);
await browser.close();
server.kill('SIGTERM');
