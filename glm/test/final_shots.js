// Final screenshots for visual confirmation.
const { chromium } = require("playwright");
const fs = require("fs");
const PNG = require("pngjs").PNG;
function analyze(file) {
  if (!fs.existsSync(file)) return null;
  const png = PNG.sync.read(fs.readFileSync(file));
  const cats = {}; let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const R = png.data[i]/255, G = png.data[i+1]/255, B = png.data[i+2]/255;
    let c = "other";
    if (B>0.6 && B>=R && B>=G && G>0.5) c = "sky";
    else if (R>0.45 && G<0.32 && B<0.32) c = "red";
    else if (R>0.7 && G>0.5 && B<0.45) c = "gold";
    else if (B>R+0.04 && B>G+0.04) c = "bluish";
    else if (G>0.45 && G>R+0.05) c = "green";
    else if (R>0.4 && G>0.3 && B<0.32) c = "brown";
    else if (R<0.3 && G<0.3 && B<0.3) c = "black";
    cats[c] = (cats[c]||0)+1; n++;
  }
  const pct = {}; for (const k in cats) pct[k] = (cats[k]/n*100).toFixed(1)+"%";
  return pct;
}
const URL = "http://localhost:8000/";
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type()==="error") errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const l = document.getElementById("loading"); return !l || l.style.display === "none"; }, { timeout: 25000 });
  await page.waitForTimeout(600);

  const results = {};
  // Start view (player on start platform)
  await page.evaluate(() => { const T=window.GAME._test; T.setCameraYaw(Math.PI); T.setCameraDist(8); T.setCameraPitch(0.32); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test/final_start.png" });
  results.start = analyze("test/final_start.png");

  // Overview (high angle from front-side showing whole level)
  await page.evaluate(() => { const T=window.GAME._test; T.setCameraDist(22); T.setCameraPitch(0.85); T.setCameraYaw(Math.PI*1.1); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test/final_overview.png" });
  results.overview = analyze("test/final_overview.png");

  // Goal/flag view
  await page.evaluate(() => { const T=window.GAME._test; T.setPlayerPos(0,6.02,26); T.setCameraYaw(Math.PI); T.setCameraDist(6); T.setCameraPitch(0.1);
    window.__h=setInterval(()=>{T.setPlayerPos(0,6.02,26);T.setPlayerVel(0,0,0);},16); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test/final_flag.png" });
  results.flag = analyze("test/final_flag.png");
  await page.evaluate(() => clearInterval(window.__h));

  console.log(JSON.stringify(results, null, 1));
  console.log("errors:", errors.length, JSON.stringify(errors));
  await browser.close();
})();