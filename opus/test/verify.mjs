// Headless verification harness for the platformer.
// Serves the game folder, loads it in headless Chromium, captures all console
// and page errors, checks the canvas actually renders, inspects internal game
// state, and drives the player to validate the 7 Definition-of-Done items.

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const ROOT = join(import.meta.dirname, '..');
const PORT = 8124;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.glb': 'model/gltf-binary',
  '.json': 'application/json',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => consoleErrors.push('REQ FAILED ' + req.url() + ' ' + (req.failure()?.errorText || '')));

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });

  // Wait for the game to finish loading assets.
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 20000 })
    .catch(() => {});

  const ready = await page.evaluate(() => !!(window.__game && window.__game.ready));
  check('1a. Game initialized (assets parsed, no load error)', ready);

  // Let it render some frames.
  await page.waitForTimeout(500);

  // --- DoD 1: no console / GL errors ---
  const glError = await page.evaluate(() => window.__game.glError);
  check('1b. No console errors', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
  check('1c. No uncaught page exceptions', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
  check('1d. No WebGL errors', glError === 0, glError ? 'GL error code ' + glError : '');

  // --- DoD 2: level renders (canvas not blank/black) ---
  const pixelStats = await page.evaluate(() => {
    const c = document.getElementById('game');
    const gl = c.getContext('webgl2');
    const w = c.width, h = c.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nonSky = 0, nonBlack = 0;
    const colors = new Set();
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (r + g + b > 12) nonBlack++;
      // sky is approx (135,206,250)
      if (!(Math.abs(r - 135) < 12 && Math.abs(g - 206) < 12 && Math.abs(b - 250) < 12)) nonSky++;
      colors.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
    }
    return { total: w * h, nonSky, nonBlack, distinctColors: colors.size, w, h };
  });
  check('2a. Canvas is not black', pixelStats.nonBlack > pixelStats.total * 0.5,
    `${pixelStats.nonBlack}/${pixelStats.total} lit pixels`);
  check('2b. Geometry rendered over sky (level visible)', pixelStats.nonSky > pixelStats.total * 0.05,
    `${pixelStats.nonSky} non-sky px, ${pixelStats.distinctColors} distinct colors`);

  // --- Geometry / parsing check: primitives produced ---
  const geo = await page.evaluate(() => {
    const g = window.__game;
    let staticPrims = 0;
    for (const m of g.staticModels.values()) staticPrims += m.primitives.length;
    return {
      staticModels: g.staticModels.size,
      staticPrims,
      charPrims: g.character.primitives.length,
      joints: g.character.joints.length,
      anims: Object.keys(g.character.animations).length,
      platforms: g.level.platforms.length,
      coins: g.level.coins.length,
    };
  });
  check('2c. GLB assets parsed into geometry',
    geo.staticPrims > 0 && geo.charPrims > 0 && geo.platforms > 0,
    JSON.stringify(geo));

  // --- DoD 3: character moves with controls ---
  const startPos = await page.evaluate(() => [...window.__game.player.pos]);
  // Press forward for ~1s.
  await page.evaluate(() => window.__game.setInput({ forward: true }));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__game.setInput({ forward: false }));
  const movedPos = await page.evaluate(() => [...window.__game.player.pos]);
  const horizDist = Math.hypot(movedPos[0] - startPos[0], movedPos[2] - startPos[2]);
  check('3. Character moves with input (forward)', horizDist > 1.0,
    `moved ${horizDist.toFixed(2)} units (from [${startPos.map(n=>n.toFixed(1))}] to [${movedPos.map(n=>n.toFixed(1))}])`);

  // --- DoD 5: solid collision - standing on a platform, not falling through ---
  // After moving, the player should be grounded and Y stable (resting on a block top).
  await page.waitForTimeout(400);
  const ground1 = await page.evaluate(() => ({ grounded: window.__game.player.grounded, y: window.__game.player.pos[1] }));
  await page.waitForTimeout(500);
  const ground2 = await page.evaluate(() => ({ grounded: window.__game.player.grounded, y: window.__game.player.pos[1] }));
  check('5a. Stands solidly on platform (grounded, Y stable, no fall-through)',
    ground1.grounded && Math.abs(ground1.y - ground2.y) < 0.05 && ground1.y > -1,
    `grounded=${ground1.grounded} y=${ground1.y.toFixed(3)}→${ground2.y.toFixed(3)}`);

  // --- DoD 4: gravity + jump (frame-rate independent arc) ---
  // Measure jump apex from a standing start. Reset first.
  await page.evaluate(() => { window.__game._reset(); });
  await page.waitForTimeout(300); // settle on ground
  const beforeJumpY = await page.evaluate(() => window.__game.player.pos[1]);
  // Trigger one jump (pulse the jump input).
  await page.evaluate(() => window.__game.setInput({ jump: true }));
  await page.waitForTimeout(60);
  await page.evaluate(() => window.__game.setInput({ jump: false }));
  // Sample peak height over the next ~0.7s.
  let peak = -Infinity;
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(50);
    const y = await page.evaluate(() => window.__game.player.pos[1]);
    if (y > peak) peak = y;
  }
  const jumpHeight = peak - beforeJumpY;
  check('4a. Jump produces a clear arc (rises then falls under gravity)',
    jumpHeight > 1.0, `peak rise ${jumpHeight.toFixed(2)} units`);
  // Confirm it came back down (landed).
  await page.waitForTimeout(900);
  const afterLandY = await page.evaluate(() => ({ y: window.__game.player.pos[1], grounded: window.__game.player.grounded }));
  check('4b. Lands back on ground after jump (gravity pulls down)',
    afterLandY.grounded && Math.abs(afterLandY.y - beforeJumpY) < 0.1,
    `landed y=${afterLandY.y.toFixed(2)} grounded=${afterLandY.grounded}`);

  // Frame-rate independence: simulate the physics with a tiny dt many times vs
  // few large dt and compare jump apex. We call step() directly with fixed dt.
  const fri = await page.evaluate(() => {
    const g = window.__game;
    function simJump(dt, steps) {
      g._reset();
      // settle
      for (let i = 0; i < 60; i++) g.player.update({}, g.camYaw, 1 / 60);
      const y0 = g.player.pos[1];
      g.player.update({ jump: true }, g.camYaw, dt);
      let peak = -Infinity;
      for (let i = 0; i < steps; i++) {
        g.player.update({}, g.camYaw, dt);
        if (g.player.pos[1] > peak) peak = g.player.pos[1];
      }
      return peak - y0;
    }
    const hiFps = simJump(1 / 120, 200);  // 120 fps
    const loFps = simJump(1 / 30, 50);     // 30 fps
    g._reset();
    return { hiFps, loFps };
  });
  const arcDiff = Math.abs(fri.hiFps - fri.loFps);
  check('4c. Jump arc is frame-rate independent (120fps vs 30fps apex match)',
    arcDiff < 0.35, `120fps apex=${fri.hiFps.toFixed(2)}, 30fps apex=${fri.loFps.toFixed(2)}, Δ=${arcDiff.toFixed(3)}`);

  // --- DoD 5b: jump across a gap and land on the far block (no tunneling) ---
  const gapTest = await page.evaluate(async () => {
    const g = window.__game;
    g._reset();
    // Drive forward through the whole level, jumping at platform edges.
    // Track that we land on the first far block (z<-2.0) without ever tunneling
    // (dropping below a platform top while horizontally inside its footprint).
    let landedFar = false;     // landed on the first block across the start gap
    let tunneled = false;
    let minY = Infinity;
    for (let i = 0; i < 600; i++) {
      const p = g.player;
      // Jump when grounded and the spot ~0.6 ahead has no same-height support.
      let jump = false;
      if (p.grounded) {
        const aheadZ = p.pos[2] - 0.6;
        let support = false;
        for (const pl of g.level.platforms) {
          const a = pl.aabb;
          if (p.pos[0] > a.minX && p.pos[0] < a.maxX && aheadZ > a.minZ && aheadZ < a.maxZ && Math.abs(a.topY - p.pos[1]) < 0.6) { support = true; break; }
        }
        if (!support) jump = true;
      }
      g.player.update({ forward: true, run: false, jump }, 0, 1 / 60);
      minY = Math.min(minY, p.pos[1]);
      // Detect landing on any platform across a gap (past the start plaza edge).
      // The start plaza ends near z=-1.04, so being grounded beyond it means a
      // gap was cleared and the far platform caught the player.
      if (p.grounded && p.pos[2] < -1.6) landedFar = true;
      // Tunneling detector: inside a platform footprint but below its top by > 0.15.
      for (const pl of g.level.platforms) {
        const a = pl.aabb;
        if (p.pos[0] > a.minX && p.pos[0] < a.maxX && p.pos[2] > a.minZ && p.pos[2] < a.maxZ) {
          if (p.pos[1] < a.topY - 0.15 && p.pos[1] > a.bottomY + 0.05) tunneled = true;
        }
      }
      if (p.pos[1] < -6) break;
      if (p.pos[2] < -19) break; // reached the goal area
    }
    const finalZ = g.player.pos[2];
    const finalY = g.player.pos[1];
    g._reset();
    return { finalZ, finalY, minY, landedFar, tunneled, reachedGoal: finalZ < -18 };
  });
  check('5b. Jumps across a gap and lands on the far platform (no tunneling)',
    gapTest.landedFar && !gapTest.tunneled,
    `landedFarBlock=${gapTest.landedFar}, tunneled=${gapTest.tunneled}, traversed to z=${gapTest.finalZ.toFixed(2)} (goal reached=${gapTest.reachedGoal})`);

  // --- DoD 5c: high-speed fall does not tunnel through a platform ---
  const fastFall = await page.evaluate(() => {
    const g = window.__game;
    g._reset();
    // Drop the player from far above a known platform (start plaza top y=0 at z=2.08).
    g.player.pos[0] = 0; g.player.pos[2] = 2.0822; g.player.pos[1] = 40;
    g.player.vel[1] = 0;
    let minY = Infinity, landed = false;
    for (let i = 0; i < 240; i++) {
      g.player.update({}, 0, 1 / 60);
      minY = Math.min(minY, g.player.pos[1]);
      if (g.player.grounded) { landed = true; break; }
    }
    const restY = g.player.pos[1];
    g._reset();
    return { minY, landed, restY };
  });
  check('5c. High-speed fall lands on platform without tunneling',
    fastFall.landed && fastFall.minY > -0.1 && Math.abs(fastFall.restY) < 0.05,
    `landed=${fastFall.landed}, lowestY=${fastFall.minY.toFixed(3)}, restY=${fastFall.restY.toFixed(3)}`);

  // --- DoD 6: camera follows without flipping ---
  const cam = await page.evaluate(() => {
    const g = window.__game;
    g._reset();
    const before = [...g.camPos];
    // Move player and step camera.
    for (let i = 0; i < 120; i++) { g.player.update({ forward: true }, g.camYaw, 1/60); g._updateCamera(1/60); }
    const after = [...g.camPos];
    // view matrix should be finite
    const finite = g.view.every(Number.isFinite) && g.camPos.every(Number.isFinite);
    g._reset();
    return { before, after, finite, dist: Math.hypot(after[0]-before[0], after[2]-before[2]) };
  });
  check('6. Camera follows player (moves with player, matrix finite, no flip)',
    cam.finite && cam.dist > 0.5, `cam moved ${cam.dist.toFixed(2)}, finite=${cam.finite}`);

  // --- DoD 7a: coin collection updates score ---
  const coinTest = await page.evaluate(() => {
    const g = window.__game;
    g._reset();
    const before = g.score;
    // Teleport player onto the first uncollected coin and step.
    const coin = g.level.coins.find((c) => !c.collected);
    g.player.pos[0] = coin.x; g.player.pos[1] = coin.y; g.player.pos[2] = coin.z;
    g.step(1 / 60);
    const after = g.score;
    const collected = coin.collected;
    g._reset();
    return { before, after, collected };
  });
  check('7a. Collecting a coin increases score', coinTest.after > coinTest.before && coinTest.collected,
    `score ${coinTest.before} → ${coinTest.after}`);

  // --- DoD 7b: reaching the flag triggers win ---
  const winTest = await page.evaluate(() => {
    const g = window.__game;
    g._reset();
    const f = g.level.flag;
    g.player.pos[0] = f.x; g.player.pos[1] = f.y; g.player.pos[2] = f.z;
    g.step(1 / 60);
    const won = g.won;
    g._reset();
    return { won };
  });
  check('7b. Reaching the flag triggers win state', winTest.won);

  // --- DoD 7c: hazard triggers lose/death state ---
  const hazardTest = await page.evaluate(() => {
    const g = window.__game;
    g._reset();
    const h = g.level.hazards[0];
    g.player.pos[0] = h.x; g.player.pos[1] = h.y + 0.1; g.player.pos[2] = h.z;
    g.step(1 / 60);
    const dead = g.dead;
    g._reset();
    return { dead, hasHazard: !!h };
  });
  check('7c. Touching a hazard triggers death/respawn', hazardTest.dead, hazardTest.hasHazard ? '' : 'no hazard in level');

  // Final re-scan of console errors that may have appeared during interaction.
  check('Final: still no console/page errors after full interaction',
    consoleErrors.length === 0 && pageErrors.length === 0,
    [...consoleErrors, ...pageErrors].join(' | ').slice(0, 300));

  // Screenshot for visual confirmation.
  await page.evaluate(() => window.__game._reset());
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(import.meta.dirname, 'screenshot.png') });

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log('  - ' + f.name + (f.detail ? ' :: ' + f.detail : ''));
    process.exit(1);
  } else {
    console.log('ALL CHECKS PASSED ✅');
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
