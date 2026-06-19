const { chromium } = require("playwright");
const URL = "http://localhost:8000/";
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => { const l = document.getElementById("loading"); return !l || l.style.display === "none"; }, { timeout: 25000 });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const T = window.GAME._test; const cm = T.charModel();
    function rotAt(animName, t) {
      const ai = window.GLB.findAnim(cm, animName);
      window.GLB.sampleAnimation(cm, ai, t);
      // leg-left = node 2, leg-right = node 3, arm-left = 5, arm-right = 6
      return {
        legL: cm.nodes[2].rotation.slice(),
        legR: cm.nodes[3].rotation.slice(),
        armL: cm.nodes[5].rotation.slice(),
        torso: cm.nodes[4].rotation.slice(),
      };
    }
    const w0 = rotAt("walk", 0);
    const w1 = rotAt("walk", 0.33);
    function qdist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2],a[3]-b[3]);}
    // skinned world bounds at two times (feet should move)
    function boundsAt(animName, t) {
      const ai = window.GLB.findAnim(cm, animName);
      window.GLB.sampleAnimation(cm, ai, t);
      const root = cm.nodes[cm.rootNodes[0]];
      root.translation=[0,1,0]; root.rotation=[0,0,0,1]; root.scale=[1,1,1];
      root.local = window.Mat4.fromTRS(root.translation,root.rotation,root.scale);
      window.GLB.updateWorld(cm, window.Mat4.identity());
      return T.charWorldBounds();
    }
    const bw0 = boundsAt("walk", 0);
    const bw1 = boundsAt("walk", 0.33);
    return {
      legLrotDelta: qdist(w0.legL, w1.legL),
      legRrotDelta: qdist(w0.legR, w1.legR),
      armLrotDelta: qdist(w0.armL, w1.armL),
      boundsMinY0: bw0.min[1], boundsMinY1: bw1.min[1],
      boundsMaxZ0: bw0.max[2], boundsMaxZ1: bw1.max[2],
    };
  });
  console.log(JSON.stringify(r, null, 1));
  const ok = (r.legLrotDelta > 0.01 || r.legRrotDelta > 0.01) && Math.abs(r.boundsMinY0 - r.boundsMinY1) > 0.001;
  console.log(ok ? "ANIM: PASS (walk animation drives skeleton & deforms mesh)" : "ANIM: FAIL");
  await b.close();
  process.exit(ok?0:1);
})();
