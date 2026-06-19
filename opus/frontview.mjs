import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
const ROOT='/Users/jameswhitford/ritza/techstackups/james-workspace/code/runs/opus';
const PORT=8137;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.glb':'model/gltf-binary'};
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const f=join(ROOT,normalize(p).replace(/^(\.\.[/\\])+/,''));const d=await readFile(f);res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(PORT,r));
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:500,height:500}});
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction(()=>window.__game&&window.__game.ready,null,{timeout:20000});
await page.evaluate(()=>{
  const g=window.__game; const gl=g.renderer.gl;
  const {mat4}=window.__gameModules;
  const proj=mat4.create(), view=mat4.create();
  const aspect=g.renderer.resize();
  mat4.perspective(proj,0.9,aspect,0.1,100);
  // view from front (-Z looking at +Z? character faces -Z by default). Look from +Z front.
  mat4.lookAt(view,[0,0.6,2.2],[0,0.45,0],[0,1,0]);
  gl.clearColor(0.4,0.5,0.6,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  g.character.pose('idle',0);
  // rotate char 180 so its face (front) points to camera
  const rot=mat4.create(); mat4.fromYRotation(rot,0);
  g.renderer.drawSkinned(g.character,proj,view,rot,g.character.jointMatrices);
});
await page.screenshot({path:'frontview.png'});
await browser.close();server.close();
