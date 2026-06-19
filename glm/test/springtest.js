const { chromium } = require("playwright");
const URL = "http://localhost:8000/";
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => { const l = document.getElementById("loading"); return !l || l.style.display === "none"; }, { timeout: 25000 });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const T = window.GAME._test;
    T.setPaused(true); T.resetKeys();
    T.setCameraYaw(Math.PI);
    // place player on the spring pillar, walking forward onto spring, holding W
    T.setPlayerPos(0, 3.0, 13.4); T.setPlayerVel(0,0,0);
    for (let i=0;i<30;i++) T.stepPhysics(1/120);
    T.setKey("w", true);
    let maxH=0, landed6=false;
    for (let i=0;i<400;i++){ // ~3.3s
      T.stepPhysics(1/120);
      const pl=T.player();
      maxH=Math.max(maxH, pl.pos[1]);
      if (pl.pos[1] > 4.8 && pl.pos[1] < 5.2 && pl.grounded && pl.pos[2] > 16 && pl.pos[2] < 19) landed6=true;
    }
    T.setKey("w", false);
    const pl=T.player();
    return { maxH, finalZ: pl.pos[2], finalY: pl.pos[1], landed6 };
  });
  console.log(JSON.stringify(r));
  const ok = r.maxH > 6 && r.landed6;
  console.log(ok ? "SPRING: PASS (launched high & landed on high platform 6)" : "SPRING: FAIL");
  await b.close();
  process.exit(ok?0:1);
})();
