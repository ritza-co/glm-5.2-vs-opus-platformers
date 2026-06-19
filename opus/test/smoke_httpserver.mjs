// Smoke test against the DOCUMENTED run command (python3 -m http.server).
// Confirms the game loads first-try with zero console/page/GL errors and renders.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8200/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
const consoleErrors = [], pageErrors = [], failedReq = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => failedReq.push(r.url() + ' ' + (r.failure()?.errorText || '')));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 20000 });
await page.waitForTimeout(800);

const state = await page.evaluate(() => ({
  ready: window.__game.ready,
  glError: window.__game.glError,
  frames: window.__game.frameCount,
  platforms: window.__game.level.platforms.length,
}));

console.log('ready:', state.ready, '| frames advanced:', state.frames, '| glError:', state.glError);
console.log('console errors:', consoleErrors.length, consoleErrors);
console.log('page errors:', pageErrors.length, pageErrors);
console.log('failed requests:', failedReq.length, failedReq);

await browser.close();

const ok = state.ready && state.glError === 0 && state.frames > 10 &&
  consoleErrors.length === 0 && pageErrors.length === 0 && failedReq.length === 0;
console.log(ok ? '\nSMOKE TEST PASSED ✅ (runs first try via python3 -m http.server)' : '\nSMOKE TEST FAILED ❌');
process.exit(ok ? 0 : 1);
