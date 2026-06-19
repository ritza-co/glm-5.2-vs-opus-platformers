// Traversability test: a bot plays the level forward and must reach the goal area.
const { chromium } = require("playwright");
const URL = "http://localhost:8000/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const l = document.getElementById("loading"); return !l || l.style.display === "none"; }, { timeout: 25000 });
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const T = window.GAME._test;
    T.setPaused(true);
    T.setCameraYaw(Math.PI); T.resetCamera();
    T.resetKeys();
    T.setPlayerPos(0, 1.05, 0); T.setPlayerVel(0,0,0);
    const lvl = T.level();
    // ground check: is there a solid platform top supporting a point (x,footY,z)?
    function groundTopAt(x, y, z, fwd) {
      // find highest platform top under (x+fwd*?, z) whose top is <= y+0.2 and >= y-1.5
      let best = -Infinity;
      for (const p of lvl) {
        if (p.collectible || p.goal || p.spring) continue;
        const b = p.aabb;
        if (x >= b.min[0]-0.05 && x <= b.max[0]+0.05 && z >= b.min[2]-0.05 && z <= b.max[2]+0.05) {
          if (b.max[1] <= y + 0.25 && b.max[1] >= y - 1.6) best = Math.max(best, b.max[1]);
        }
      }
      return best;
    }
    // Bot: move forward (+Z). Jump when grounded AND (edge ahead OR step up ahead).
    let maxZ = 0, maxZt = 0;
    let reachedGoal = false;
    let died = 0;
    const trace = [];
    const fwd = [0, 1]; // +Z (cameraYaw=PI -> W is +Z)
    const N = 60 * 20; // 20 seconds sim at 60fps steps
    for (let i = 0; i < N; i++) {
      T.setKey("w", true);
      // walk (not sprint) for precise landings
      const p = T.player();
      maxZ = Math.max(maxZ, p.pos[2]);
      // detect edge / step ahead
      const aheadX = p.pos[0], aheadZ = p.pos[2] + 0.7;
      const gt = groundTopAt(aheadX, p.pos[1], aheadZ, 1);
      const shouldJump = p.grounded && (gt === -Infinity || gt > p.pos[1] + 0.15);
      if (shouldJump) T.jump();   // space -> jump buffer
      T.stepPhysics(1/60);
      const p2 = T.player();
      if (p2.pos[2] > 12.5 && p2.pos[2] < 20 && trace.length < 200) trace.push([i, p2.pos[0].toFixed(2), p2.pos[1].toFixed(2), p2.pos[2].toFixed(2), p2.vel[1].toFixed(1), p2.grounded]);
      // track progress
      if (p2.pos[2] > maxZt) maxZt = p2.pos[2];
      if (p2.pos[1] < -10) died++;
      // reached goal area?
      if (p2.pos[2] > 26.0 && p2.pos[1] > 5.0) reachedGoal = true;
    }
    T.setKey("w", false);
    const p = T.player();
    return { finalZ: p.pos[2], finalY: p.pos[1], maxZ, reachedGoal, died, goalZ: 28.0, trace: trace.slice(0, 120) };
  });

  console.log(JSON.stringify(result, null, 1));
  console.log("--- trace (i x y z vy grounded) ---");
  for (let i = 0; i < result.trace.length; i += 2) console.log(result.trace[i].join("  "));
  console.log("errors:", errors);
  const ok = result.reachedGoal;
  console.log(ok ? "TRAVERSABILITY: PASS (bot reached goal area)" : "TRAVERSABILITY: FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();