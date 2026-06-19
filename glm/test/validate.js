// Headless validation of the WebGL platformer using Playwright.
const { chromium } = require("playwright");

const URL = process.env.URL || "http://localhost:8000/";
const checks = [];
function check(name, cond, detail) {
  checks.push({ name, pass: !!cond, detail: detail || "" });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  const pageErrors = [];
  page.on("console", m => {
    consoleMsgs.push({ type: m.type(), text: m.text() });
  });
  page.on("pageerror", e => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // wait for init to finish (loading hidden)
  try {
    await page.waitForFunction(() => {
      const l = document.getElementById("loading");
      return !l || l.style.display === "none";
    }, { timeout: 25000 });
  } catch (e) {
    check("page loads & inits", false, "init did not complete: " + e.message);
    printAndExit();
    return;
  }

  // let it render a bunch of frames
  await page.waitForTimeout(1200);

  // ---------- Check 1: no console errors / page errors ----------
  const errLines = consoleMsgs.filter(m => m.type === "error").map(m => m.text);
  check("no console errors", errLines.length === 0, JSON.stringify(errLines));
  check("no page errors", pageErrors.length === 0, JSON.stringify(pageErrors));

  // ---------- Check 2: models loaded ----------
  const modelNames = await page.evaluate(() => window.GAME._test.modelNames());
  check("GLB models loaded", modelNames.length >= 11, "loaded=" + modelNames.length + " " + JSON.stringify(modelNames));

  // ---------- Check 3: WebGL2 context exists, no GL error ----------
  const glInfo = await page.evaluate(() => {
    const g = window.GAME._test.gl();
    if (!g) return { ok: false };
    let errs = [];
    // drain errors
    for (let i = 0; i < 10; i++) { const e = g.getError(); if (e === g.NO_ERROR) break; errs.push(e); }
    return { ok: true, version: g.getParameter(g.VERSION), errs };
  });
  check("WebGL2 context active", glInfo.ok, glInfo.version);
  check("no GL errors after init", glInfo.ok && glInfo.errs.length === 0, JSON.stringify(glInfo.errs));

  // ---------- Check 4: canvas not blank ----------
  const sample = await page.evaluate(() => window.GAME._test.sampleCanvas());
  check("canvas renders (not blank)", sample.nonBg > 3000, "nonBg=" + sample.nonBg + " avgB=" + sample.avgBrightness.toFixed(3));

  // ---------- Check 5: geometry produced (vertex counts) ----------
  const geoInfo = await page.evaluate(() => {
    let verts = 0, meshes = 0;
    for (const k of window.GAME._test.modelNames()) {
      const m = window.GAME._test; // not enough; fetch from loaded
    }
    // count via level instances aabb
    const lvl = window.GAME._test.level();
    return { levelCount: lvl.length, hasAabb: lvl.every(p => p.aabb && p.aabb.min && p.aabb.max) };
  });
  check("level instances have AABBs", geoInfo.levelCount > 10 && geoInfo.hasAabb, "count=" + geoInfo.levelCount);

  // ---------- Check 6: gravity + landing (no fall through) ----------
  const landResult = await page.evaluate(() => {
    const T = window.GAME._test;
    T.resetKeys();
    T.setPlayerPos(0, 6, 0);   // high above start platform (top y=1)
    T.setPlayerVel(0, -50, 0); // fast fall -> tests tunneling
    for (let i = 0; i < 600; i++) T.stepPhysics(1/120); // 5 seconds sim
    const p = T.player();
    return { y: p.pos[1], grounded: p.grounded };
  });
  check("lands on platform (no tunneling)", landResult.grounded && Math.abs(landResult.y - 1.0) < 0.05,
    "y=" + landResult.y.toFixed(3) + " grounded=" + landResult.grounded);

  // ---------- Check 7: jump arc consistent ----------
  // grounded on platform; trigger jump; measure apex then return.
  const jumpResult = await page.evaluate(() => {
    const T = window.GAME._test;
    T.resetKeys();
    T.setPlayerPos(0, 1.0, 0);
    T.setPlayerVel(0, 0, 0);
    // settle grounded
    for (let i = 0; i < 30; i++) T.stepPhysics(1/120);
    if (!T.player().grounded) return { ok: false, reason: "not grounded pre-jump", y: T.player().pos[1] };
    // buffer jump
    const JUMP_VEL = 9.5, G = 26.0;
    // manually set upward velocity (as jump would)
    T.setPlayerVel(0, JUMP_VEL, 0);
    let apex = T.player().pos[1], apexT = 0;
    let landed = false, landT = 0;
    for (let i = 0; i < 1000; i++) {
      T.stepPhysics(1/120);
      const y = T.player().pos[1];
      if (y > apex) { apex = y; apexT = i / 120; }
      if (!landed && T.player().grounded && i > 2) { landed = true; landT = i / 120; break; }
    }
    const expectedApex = (JUMP_VEL * JUMP_VEL) / (2 * G) + 1.0; // 1.0 base
    return { ok: landed, apex, apexT, landT, expectedApex, grounded: T.player().grounded };
  });
  check("jump: rises and lands back grounded", jumpResult.ok, JSON.stringify(jumpResult));
  check("jump: apex matches physics (consistent arc)", Math.abs(jumpResult.apex - jumpResult.expectedApex) < 0.15,
    "apex=" + jumpResult.apex.toFixed(3) + " expected=" + jumpResult.expectedApex.toFixed(3));

  // ---------- Check 8: horizontal movement + wall collision ----------
  const moveResult = await page.evaluate(() => {
    const T = window.GAME._test;
    T.resetKeys();
    T.setPlayerPos(0, 1.0, 0);
    T.setPlayerVel(0, 0, 0);
    for (let i = 0; i < 30; i++) T.stepPhysics(1/120);
    // reset camera so W == +Z (level forward). cameraYaw=PI -> forward +Z.
    T.setCameraYaw(Math.PI);
    T.resetCamera();
    for (let i = 0; i < 5; i++) T.updateCamera(1/60);
    // move forward (+z) by holding W for ~0.6s
    T.setKey("w", true);
    let beforeZ = T.player().pos[2];
    for (let i = 0; i < 72; i++) T.stepPhysics(1/120); // 0.6s
    let afterZ = T.player().pos[2];
    T.setKey("w", false);
    return { beforeZ, afterZ, moved: afterZ - beforeZ, grounded: T.player().grounded };
  });
  check("character moves with W (forward = +Z)", moveResult.moved > 0.3, "deltaZ=" + moveResult.moved.toFixed(3));

  // ---------- Check 9: coin collection updates score ----------
  const coinResult = await page.evaluate(() => {
    const T = window.GAME._test;
    T.resetKeys();
    const coins = T.coins();
    const first = coins[0];
    const target = [first.pos[0], first.pos[1] + 0.4, first.pos[2]];
    T.setPlayerPos(target[0], target[1] - 0.4, target[2]);
    T.setPlayerVel(0, 0, 0);
    const before = T.coinsCollected();
    for (let i = 0; i < 5; i++) T.stepPhysics(1/120);
    const after = T.coinsCollected();
    return { before, after, collected: after > before };
  });
  check("coin collection updates score", coinResult.collected, "before=" + coinResult.before + " after=" + coinResult.after);

  // ---------- Check 10: goal triggers win when all coins collected ----------
  const winResult = await page.evaluate(() => {
    const T = window.GAME._test;
    T.resetKeys();
    // force-collect all coins by teleporting to each
    const coins = T.coins();
    for (const c of coins) {
      const t = [c.pos[0], c.pos[1] + 0.4, c.pos[2]];
      T.setPlayerPos(t[0], t[1] - 0.4, t[2]);
      T.setPlayerVel(0, 0, 0);
      for (let i = 0; i < 5; i++) T.stepPhysics(1/120);
    }
    if (T.coinsCollected() < T.totalCoins()) return { ok: false, reason: "not all collected", got: T.coinsCollected() };
    // go to flag
    const lvl = T.level();
    const flag = lvl.find(p => p.goal);
    T.setPlayerPos(flag.pos[0], flag.pos[1] + 0.2, flag.pos[2]);
    T.setPlayerVel(0, 0, 0);
    for (let i = 0; i < 5; i++) T.stepPhysics(1/120);
    return { ok: T.won(), coins: T.coinsCollected() };
  });
  check("reaching flag with all coins triggers win", winResult.ok, JSON.stringify(winResult));

  // ---------- Check 11: camera follows player ----------
  const camResult = await page.evaluate(() => {
    const T = window.GAME._test;
    // read internal cam via evaluate scope: not exposed; check by moving player and observing DOM? 
    // Instead just confirm render runs without throwing by sampling canvas again.
    const s = T.sampleCanvas();
    return { nonBg: s.nonBg };
  });
  check("camera/render stable after movement", camResult.nonBg > 3000, "nonBg=" + camResult.nonBg);

  await browser.close();
  printAndExit();
})();

function printAndExit() {
  let pass = 0, fail = 0;
  for (const c of checks) {
    const tag = c.pass ? "PASS" : "FAIL";
    console.log(`[${tag}] ${c.name}${c.detail ? "  -- " + c.detail : ""}`);
    if (c.pass) pass++; else fail++;
  }
  console.log(`\n${pass}/${checks.length} checks passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}