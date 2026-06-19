// game.js - 3D platformer: level, physics, camera, animation, game state
"use strict";

const GAME = (() => {

const STEP = 1/120;            // fixed physics step
const GRAVITY = -26.0;
const JUMP_VEL = 9.5;
const MOVE_SPEED = 4.2;
const SPRINT_SPEED = 7.0;
const TERMINAL_VEL = -22.0;
const PLAYER_HW = 0.34;        // half width (x,z)
const PLAYER_HEIGHT = 0.92;
const COYOTE_TIME = 0.10;
const JUMP_BUFFER = 0.12;

// ---- Globals ----
let renderer, gl;
const models = {};      // name -> model (raw glTF)
const gpu = {};         // name -> uploaded gpu model
let canvas;
const keys = {};
let mouseDrag = false, lastMx = 0;
let cameraYaw = Math.PI, cameraPitch = 0.42, cameraDist = 7.2; // yaw=PI: camera behind player looking +Z (along level)
let camPos = [0,5,10], camTarget = [0,0,0];
let level = [];         // platform instances
let coins = [];         // collectible instances
let hazards = [];       // hazard instances
let goalInstance = null;
const player = {
  pos: [0, 1, 0],
  vel: [0,0,0],
  grounded: false,
  facing: 0,
  animTime: 0,
  anim: "idle",
  coyote: 0,
  jumpBuffer: 0,
};
let coinsCollected = 0, totalCoins = 0, deaths = 0, won = false;
let startTime = 0;
let debug = true;
let charVisible = true;
let charModel, charGpu, charAnim = {};

// Character model default front assumed +Z (glTF). rotationY(theta) maps +Z -> (-sin, cos),
// so to point front along (mx,mz) use theta = atan2(-mx, mz).
const FACING_OFFSET = 0;

// materialType: 0 flat, 1 grass, 2 snow
function assetColor(name) {
  if (name.indexOf("grass") >= 0) return { type: 1, color: [0,0,0] };
  if (name.indexOf("snow") >= 0) return { type: 2, color: [0,0,0] };
  if (name.indexOf("coin-gold") >= 0) return { type: 0, color: [1.0, 0.82, 0.05] };
  if (name.indexOf("coin-silver") >= 0) return { type: 0, color: [0.85, 0.85, 0.9] };
  if (name.indexOf("coin-bronze") >= 0) return { type: 0, color: [0.8, 0.5, 0.2] };
  if (name.indexOf("jewel") >= 0) return { type: 0, color: [0.2, 0.9, 0.9] };
  if (name.indexOf("star") >= 0) return { type: 0, color: [1.0, 0.9, 0.2] };
  if (name.indexOf("flag") >= 0) return { type: 0, color: [0.9, 0.18, 0.18] };
  if (name.indexOf("spike") >= 0 || name.indexOf("saw") >= 0 || name.indexOf("bomb") >= 0 || name.indexOf("trap") >= 0)
    return { type: 0, color: [0.34, 0.32, 0.36] };
  if (name.indexOf("spring") >= 0) return { type: 0, color: [0.25, 0.55, 0.95] };
  if (name.indexOf("crate") >= 0) return { type: 0, color: [0.62, 0.44, 0.26] };
  if (name.indexOf("barrel") >= 0) return { type: 0, color: [0.5, 0.35, 0.22] };
  if (name.indexOf("character") >= 0) return { type: 0, color: [0.72, 0.86, 1.0] };
  return { type: 0, color: [0.7, 0.7, 0.72] };
}

async function loadModel(name) {
  const m = await GLB.load("assets/GLB/" + name + ".glb");
  models[name] = m;
  const ac = assetColor(name);
  gpu[name] = renderer.uploadModel(m, ac.type, ac.color);
  return m;
}

// Build a platform instance from a model name + base position (+ optional rotY)
function platform(name, x, y, z, opts = {}) {
  const m = models[name];
  const aabb = m.aabb;
  const inst = {
    model: m, gpu: gpu[name], name,
    pos: [x, y, z], rotY: opts.rotY || 0,
    color: opts.color || assetColor(name).color,
    type: opts.type !== undefined ? opts.type : assetColor(name).type,
    // world AABB (assumes rotY is 0 or 90 multiple for square/long blocks)
    aabb: null,
    spring: !!opts.spring, hazard: !!opts.hazard,
    collectible: !!opts.collectible, goal: !!opts.goal,
    collected: false, spin: opts.spin || 0, bob: opts.bob || 0,
    scale: opts.scale || [1,1,1],
    baseY: y,
  };
  inst.aabb = worldAABB(aabb, x, y, z, opts.rotY || 0);
  return inst;
}

function worldAABB(aabb, x, y, z, rotY) {
  // For rotY 0 or 90/180/270, swap min/max x/z accordingly
  let min = aabb.min.slice(), max = aabb.max.slice();
  if (Math.abs(rotY - Math.PI/2) < 0.01 || Math.abs(rotY - 3*Math.PI/2) < 0.01) {
    [min[0], min[2]] = [min[2], min[0]];
    [max[0], max[2]] = [max[2], max[0]];
  }
  return { min: [x+min[0], y+min[1], z+min[2]], max: [x+max[0], y+max[1], z+max[2]] };
}

function buildLevel() {
  level = []; coins = []; hazards = [];
  // --- Main path along +Z with gaps and height changes ---
  // Start plaza (2x2)
  level.push(platform("block-grass-large", 0, 0, 0));       // top 1 (start)
  level.push(platform("block-grass-large", 0, 0, 3.5));      // top 1, gap 1.42
  level.push(platform("block-grass-large", 0, 1, 7.0));      // top 2, up 1
  level.push(platform("block-grass-large", 0, 1, 10.5));     // top 2, gap 1.42
  level.push(platform("block-grass-large-tall", 0, 1, 14.0));// top 3, up 1 (spring pillar)
  level.push(platform("spring", 0, 3, 14.0, { spring: true }));
  level.push(platform("block-grass-large", 0, 4, 17.5));     // top 5, via spring
  level.push(platform("block-grass-large", 0, 4, 21.0));     // top 5, gap 1.42
  level.push(platform("block-grass-large", 0, 4, 24.5));     // top 5 (hazard platform)
  hazards.push(platform("trap-spikes", 0.9, 5, 24.5, { hazard: true })); level.push(hazards[hazards.length-1]);
  level.push(platform("block-grass-large-tall", 0, 4, 28.0));// top 6, up 1 (goal)

  // Decorative props on start plaza (solid)
  level.push(platform("crate", 0.8, 1, -0.4));
  level.push(platform("barrel", -0.9, 1, 0.3));

  // --- Coins (9) ---
  function coin(x, y, z) {
    const c = platform("coin-gold", x, y, z, { collectible: true, spin: 1, bob: 1 });
    coins.push(c); level.push(c);
  }
  coin(0, 1.6, 3.5);
  coin(0, 2.6, 7.0);
  coin(0, 2.6, 10.5);
  coin(0, 3.6, 14.0);   // above spring pillar
  coin(0, 5.6, 17.5);
  coin(0, 5.4, 19.25);  // over the gap (risk)
  coin(0, 5.6, 24.5);
  coin(-0.9, 5.6, 24.5);// near hazard side
  coin(0, 6.6, 28.0);

  // --- Goal flag ---
  goalInstance = platform("flag", 0, 6, 28.0, { goal: true, scale: [1.7,1.7,1.7] });
  level.push(goalInstance);

  totalCoins = coins.length;
  // player start: on start platform top (y=1)
  player.pos = [0, 1.0, 0];
  player.vel = [0,0,0];
  player.facing = 0;
}

// ---- Physics / collision ----
function playerAABB(pos) {
  return {
    min: [pos[0]-PLAYER_HW, pos[1], pos[2]-PLAYER_HW],
    max: [pos[0]+PLAYER_HW, pos[1]+PLAYER_HEIGHT, pos[2]+PLAYER_HW],
  };
}
function overlap(a, b) {
  return a.max[0] > b.min[0] && a.min[0] < b.max[0] &&
         a.max[1] > b.min[1] && a.min[1] < b.max[1] &&
         a.max[2] > b.min[2] && a.min[2] < b.max[2];
}

// Resolve movement along one axis. axis: 0=x,1=y,2=z. delta signed.
function moveAxis(pos, vel, axis, delta, p) {
  pos[axis] += delta;
  let pa = playerAABB(pos);
  const ph = PLAYER_HEIGHT;
  for (const plat of level) {
    if (plat.collectible || plat.goal || plat.spring) continue; // coins/flag/spring non-solid
    const b = plat.aabb;
    if (!overlap(pa, b)) continue;
    if (axis === 1) {
      if (delta <= 0) {
        // landing on top
        pos[1] = b.max[1];
        vel[1] = 0;
        p.grounded = true;
        if (plat.spring) { vel[1] = 15.0; p.grounded = false; }
      } else {
        // hit head
        pos[1] = b.min[1] - ph;
        vel[1] = 0;
      }
    } else if (axis === 0) {
      if (delta > 0) pos[0] = b.min[0] - PLAYER_HW;
      else pos[0] = b.max[0] + PLAYER_HW;
      vel[0] = 0;
    } else {
      if (delta > 0) pos[2] = b.min[2] - PLAYER_HW;
      else pos[2] = b.max[2] + PLAYER_HW;
      vel[2] = 0;
    }
    pa = playerAABB(pos);
  }
}

function physicsStep(dt) {
  if (won) { // still apply gravity so character rests, but no input
    player.vel[0] = 0; player.vel[2] = 0;
  }
  // horizontal input -> velocity target (frame-rate independent via fixed step)
  const move = getMoveVector();
  let speed = keys["shift"] ? SPRINT_SPEED : MOVE_SPEED;
  // accelerate toward target velocity for nice feel
  const targetVX = move.x * speed;
  const targetVZ = move.z * speed;
  const accel = player.grounded ? 18 : 10;
  player.vel[0] += (targetVX - player.vel[0]) * Math.min(1, accel * dt);
  player.vel[2] += (targetVZ - player.vel[2]) * Math.min(1, accel * dt);

  // spring bounce (before jump so it overrides): if standing/landing on a spring area
  for (const plat of level) {
    if (!plat.spring) continue;
    const b = plat.aabb;
    const inXZ = player.pos[0] > b.min[0]-0.12 && player.pos[0] < b.max[0]+0.12 &&
                player.pos[2] > b.min[2]-0.12 && player.pos[2] < b.max[2]+0.12;
    if (inXZ && player.vel[1] <= 1.0 &&
        player.pos[1] >= b.min[1]-0.35 && player.pos[1] <= b.max[1]+0.50) {
      player.pos[1] = b.max[1];
      player.vel[1] = 15.0;
      player.grounded = false;
    }
  }

  // jump
  player.coyote = player.grounded ? COYOTE_TIME : player.coyote - dt;
  if (player.jumpBuffer > 0) player.jumpBuffer -= dt;
  if (player.jumpBuffer > 0 && player.coyote > 0) {
    player.vel[1] = JUMP_VEL;
    player.grounded = false;
    player.coyote = 0;
    player.jumpBuffer = 0;
  }

  // gravity
  player.vel[1] += GRAVITY * dt;
  if (player.vel[1] < TERMINAL_VEL) player.vel[1] = TERMINAL_VEL;

  // facing: rotationY angle so model front (+Z) aligns with movement (mx,mz)
  if (move.x !== 0 || move.z !== 0) {
    player.facing = Math.atan2(-move.x, move.z);
  }

  // substepped movement to prevent tunneling
  const dx = player.vel[0] * dt;
  const dy = player.vel[1] * dt;
  const dz = player.vel[2] * dt;
  const maxMove = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const steps = Math.max(1, Math.ceil(maxMove / 0.18));
  const sdx = dx/steps, sdy = dy/steps, sdz = dz/steps;
  player.grounded = false;
  for (let s = 0; s < steps; s++) {
    moveAxis(player.pos, player.vel, 1, sdy, player);
    moveAxis(player.pos, player.vel, 0, sdx, player);
    moveAxis(player.pos, player.vel, 2, sdz, player);
  }
  if (player.grounded && player.vel[1] < 0) player.vel[1] = 0;

  // fell off the world
  if (player.pos[1] < -12) die();

  // hazards
  const pa = playerAABB(player.pos);
  for (const h of hazards) {
    if (overlap(pa, h.aabb)) { die(); break; }
  }
  // coins
  for (const c of coins) {
    if (c.collected) continue;
    const cc = [c.pos[0], c.pos[1] + 0.4, c.pos[2]];
    if (Vec3.dist([player.pos[0], player.pos[1]+PLAYER_HEIGHT*0.5, player.pos[2]], cc) < 0.9) {
      c.collected = true;
      coinsCollected++;
    }
  }
  // goal
  if (goalInstance && coinsCollected >= totalCoins) {
    const gc = [goalInstance.pos[0], goalInstance.pos[1]+0.4, goalInstance.pos[2]];
    if (Vec3.dist([player.pos[0], player.pos[1]+PLAYER_HEIGHT*0.5, player.pos[2]], gc) < 1.1) {
      won = true;
    }
  }
}

function die() {
  deaths++;
  player.pos = [0, 1.2, 0];
  player.vel = [0,0,0];
  player.grounded = false;
}

function getMoveVector() {
  let f = 0, r = 0;
  if (keys["w"] || keys["arrowup"]) f += 1;
  if (keys["s"] || keys["arrowdown"]) f -= 1;
  if (keys["d"] || keys["arrowright"]) r += 1;
  if (keys["a"] || keys["arrowleft"]) r -= 1;
  if (f === 0 && r === 0) return { x: 0, z: 0 };
  // forward direction (camera-relative) on XZ plane
  const fx = camTarget[0] - camPos[0];
  const fz = camTarget[2] - camPos[2];
  const fl = Math.hypot(fx, fz) || 1;
  const fwd = [fx/fl, fz/fl];
  const right = [-fwd[1], fwd[0]]; // right = forward rotated -90? ensure correct handedness
  let mx = fwd[0]*f + right[0]*r;
  let mz = fwd[1]*f + right[1]*r;
  const ml = Math.hypot(mx, mz);
  if (ml > 0) { mx/=ml; mz/=ml; }
  return { x: mx, z: mz };
}

// ---- Camera ----
function updateCamera(dt) {
  // smooth follow target = player upper body
  const tgt = [player.pos[0], player.pos[1] + 0.7, player.pos[2]];
  camTarget = Vec3.lerp(camTarget, tgt, Math.min(1, 8*dt));
  const horiz = cameraDist * Math.cos(cameraPitch);
  const vert = cameraDist * Math.sin(cameraPitch);
  const desired = [
    camTarget[0] + Math.sin(cameraYaw) * horiz,
    camTarget[1] + vert,
    camTarget[2] + Math.cos(cameraYaw) * horiz,
  ];
  camPos = Vec3.lerp(camPos, desired, Math.min(1, 10*dt));
}

// ---- Character animation ----
function updateCharacter(dt) {
  if (!charModel) return;
  // choose anim
  let want = "idle";
  const horizSpeed = Math.hypot(player.vel[0], player.vel[2]);
  if (!player.grounded) {
    want = player.vel[1] > 0.2 ? "jump" : "fall";
  } else if (horizSpeed > 0.6) {
    want = horizSpeed > 5.5 ? "sprint" : "walk";
  }
  if (want !== player.anim) {
    player.anim = want;
    player.animTime = 0;
  }
  player.animTime += dt;
  const idx = charAnim[want] >= 0 ? charAnim[want] : charAnim["idle"];
  GLB.sampleAnimation(charModel, idx, player.animTime);
  // set root node (node 0) to placement
  const root = charModel.nodes[charModel.rootNodes[0]];
  root.translation = [player.pos[0], player.pos[1], player.pos[2]];
  root.rotation = Quat.fromEulerY(player.facing + FACING_OFFSET);
  root.scale = [1,1,1];
  root.local = Mat4.fromTRS(root.translation, root.rotation, root.scale);
  GLB.updateWorld(charModel, Mat4.identity());
}

// ---- Render ----
let viewProj = Mat4.identity();
function render(time) {
  renderer.viewport();
  renderer.clear(0.55, 0.74, 0.92);
  renderer.useProgram();
  const aspect = canvas.width / canvas.height;
  const proj = Mat4.perspective(Math.PI/3.2, aspect, 0.1, 200);
  const view = Mat4.lookAt(camPos, camTarget, [0,1,0]);
  viewProj = Mat4.multiply(proj, view);
  renderer.setViewProj(viewProj, camPos);
  const lightDir = Vec3.norm([-0.4, 0.75, -0.45]); // from front-up (-Z) so default camera-facing sides are lit
  renderer.setLight(lightDir);
  renderer.setTime(time);

  // draw level platforms (non-collectible, non-character)
  for (const inst of level) {
    if (inst.collected) continue;
    const m = inst.model;
    const gp = inst.gpu;
    // model matrix
    let modelMat;
    if (inst.collectible) {
      const spin = time * 2.2 * inst.spin;
      const bob = Math.sin(time*2.5 + inst.pos[2]) * 0.12;
      const T = Mat4.translation(inst.pos[0], inst.pos[1] + 0.4 + bob, inst.pos[2]);
      const R = Mat4.rotationY(spin);
      modelMat = Mat4.multiply(T, R);
    } else {
      const sc = inst.scale;
      const T = Mat4.translation(inst.pos[0], inst.pos[1], inst.pos[2]);
      let R = inst.rotY ? Mat4.rotationY(inst.rotY) : Mat4.identity();
      const S = (sc[0]!==1||sc[1]!==1||sc[2]!==1) ? Mat4.scaling(sc[0], sc[1], sc[2]) : Mat4.identity();
      modelMat = Mat4.multiply(T, Mat4.multiply(R, S));
    }
    // override color (coins/flag etc already set in gpu, but ensure)
    renderer.drawModelMeshes(gp, modelMat, null);
  }

  // draw character
  if (charModel && charVisible) {
    const skinIdx = charModel.nodes.find(n => n.skin !== null && n.skin !== undefined) ? charModel.skins.length ? 0 : null : null;
    let jointMat = null;
    // find the skinned mesh node
    for (const n of charModel.nodes) {
      if (n.skin !== null && n.skin !== undefined) {
        jointMat = Renderer.computeJointMatrices(charModel, n.skin);
        break;
      }
    }
    renderer.drawModelMeshes(charGpu, Mat4.identity(), jointMat);
  }
}

// ---- Main loop ----
let lastTime = 0, acc = 0, fpsT = 0, fpsN = 0, fps = 0;
let paused = false;
function frame(tMs) {
  requestAnimationFrame(frame);
  if (paused) return;
  const t = tMs / 1000;
  let dt = lastTime ? (t - lastTime) : 0;
  lastTime = t;
  if (dt > 0.1) dt = 0.1;
  // camera input (continuous orbit keys)
  if (keys["q"]) cameraYaw -= 1.6 * dt;
  if (keys["e"]) cameraYaw += 1.6 * dt;
  updateCamera(dt);
  // physics fixed step
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 600) {
    physicsStep(STEP);
    acc -= STEP;
    steps++;
  }
  updateCharacter(dt);
  render(t);
  // fps
  fpsN++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(fpsN/fpsT); fpsN = 0; fpsT = 0; }
  updateHUD();
}

function updateHUD() {
  const hud = document.getElementById("hud");
  if (hud) {
    hud.style.display = debug ? "block" : "none";
    if (debug) {
      hud.textContent =
        `FPS ${fps}  pos (${player.pos[0].toFixed(1)}, ${player.pos[1].toFixed(1)}, ${player.pos[2].toFixed(1)})  ` +
        `grounded ${player.grounded}  anim ${player.anim}  coins ${coinsCollected}/${totalCoins}  deaths ${deaths}`;
    }
  }
  const score = document.getElementById("score");
  if (score) score.textContent = `Coins: ${coinsCollected} / ${totalCoins}`;
  const winEl = document.getElementById("win");
  if (winEl) {
    if (won) {
      winEl.style.display = "flex";
      winEl.textContent = `🎉 You Win!  Coins ${coinsCollected}/${totalCoins}  Deaths ${deaths}\nPress R to play again`;
    } else {
      winEl.style.display = "none";
    }
  }
}

function restart() {
  coinsCollected = 0; deaths = 0; won = false;
  for (const c of coins) c.collected = false;
  player.pos = [0, 1.2, 0];
  player.vel = [0,0,0];
  player.anim = "idle"; player.animTime = 0;
  startTime = performance.now();
}

async function init() {
  canvas = document.getElementById("glcanvas");
  renderer = new Renderer.R(canvas);
  gl = renderer.gl;
  // load models
  const names = [
    "block-grass-large", "block-grass", "block-grass-low-narrow", "block-grass-large-tall",
    "block-grass-low", "coin-gold", "flag", "trap-spikes", "spring", "crate", "barrel",
    "character-oopi",
  ];
  try {
    await Promise.all(names.map(n => loadModel(n)));
  } catch (e) {
    console.error("Model load failed", e);
    document.getElementById("error").textContent = "Failed to load assets: " + e.message;
    document.getElementById("error").style.display = "block";
    return;
  }
  charModel = models["character-oopi"];
  charGpu = gpu["character-oopi"];
  charAnim = {
    idle: GLB.findAnim(charModel, "idle"),
    walk: GLB.findAnim(charModel, "walk"),
    sprint: GLB.findAnim(charModel, "sprint"),
    jump: GLB.findAnim(charModel, "jump"),
    fall: GLB.findAnim(charModel, "fall"),
  };
  console.log("char anims", charAnim);

  buildLevel();
  startTime = performance.now();
  setupInput();
  requestAnimationFrame(frame);
}

function setupInput() {
  window.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === " ") {
      e.preventDefault();
      player.jumpBuffer = JUMP_BUFFER;
    }
    if (k === "r") restart();
    if (k === "f3") { debug = !debug; e.preventDefault(); }
  });
  window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener("mousedown", e => { mouseDrag = true; lastMx = e.clientX; });
  window.addEventListener("mouseup", () => { mouseDrag = false; });
  window.addEventListener("mousemove", e => {
    if (!mouseDrag) return;
    const dx = e.clientX - lastMx; lastMx = e.clientX;
    cameraYaw -= dx * 0.01;
  });
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    cameraDist = Math.max(3, Math.min(14, cameraDist + e.deltaY * 0.01));
  }, { passive: false });
  // touch
  canvas.addEventListener("touchstart", e => { if (e.touches.length){ mouseDrag=true; lastMx=e.touches[0].clientX; } });
  canvas.addEventListener("touchmove", e => {
    if (!mouseDrag || !e.touches.length) return;
    const dx = e.touches[0].clientX - lastMx; lastMx = e.touches[0].clientX;
    cameraYaw -= dx * 0.01;
  });
  canvas.addEventListener("touchend", () => { mouseDrag=false; });
}

const _test = {
  modelsLoaded: () => Object.keys(models).length,
  modelNames: () => Object.keys(models),
  player: () => player,
  level: () => level,
  coins: () => coins,
  coinsCollected: () => coinsCollected,
  totalCoins: () => totalCoins,
  won: () => won,
  deaths: () => deaths,
  stepPhysics: (dt) => physicsStep(dt),
  setKey: (k, v) => { keys[k] = v; },
  jump: () => { player.jumpBuffer = JUMP_BUFFER; },
  resetKeys: () => { for (const k in keys) keys[k] = false; },
  setPlayerPos: (x,y,z) => { player.pos=[x,y,z]; player.vel=[0,0,0]; },
  setPlayerVel: (x,y,z) => { player.vel=[x,y,z]; },
  renderAt: (t) => render(t),
  updateChar: (dt) => updateCharacter(dt),
  updateCamera: (dt) => updateCamera(dt),
  resetCamera: () => {
    camTarget = [player.pos[0], player.pos[1] + 0.7, player.pos[2]];
    const horiz = cameraDist * Math.cos(cameraPitch);
    const vert = cameraDist * Math.sin(cameraPitch);
    camPos = [
      camTarget[0] + Math.sin(cameraYaw) * horiz,
      camTarget[1] + vert,
      camTarget[2] + Math.cos(cameraYaw) * horiz,
    ];
  },
  setPaused: (v) => { paused = v; },
  setCharVisible: (v) => { charVisible = v; },
  setCameraYaw: (y) => { cameraYaw = y; },
  setCameraDist: (d) => { cameraDist = d; },
  setCameraPitch: (p) => { cameraPitch = p; },
  charModel: () => charModel,
  // compute skinned world-space AABB of the character (verifies skinning/placement)
  charWorldBounds: () => {
    if (!charModel) return null;
    // ensure transforms current
    const skinIdx = (() => { for (const n of charModel.nodes) if (n.skin!==null && n.skin!==undefined) return n.skin; return null; })();
    const jm = Renderer.computeJointMatrices(charModel, skinIdx);
    const mesh = charModel.meshes[0].primitives[0];
    const pos = mesh.position, joints = mesh.joints, weights = mesh.weights;
    let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
    const count = mesh.vertexCount;
    for (let i=0;i<count;i++){
      const px=pos[i*3], py=pos[i*3+1], pz=pos[i*3+2];
      const j0=Math.round(joints[i*4]), j1=Math.round(joints[i*4+1]), j2=Math.round(joints[i*4+2]), j3=Math.round(joints[i*4+3]);
      const w0=weights[i*4], w1=weights[i*4+1], w2=weights[i*4+2], w3=weights[i*4+3];
      let wx=0, wy=0, wz=0;
      const js=[j0,j1,j2,j3], ws=[w0,w1,w2,w3];
      for (let k=0;k<4;k++){ const M=jm.subarray(js[k]*16,(js[k]+1)*16); const w=ws[k]; wx += w*(M[0]*px+M[4]*py+M[8]*pz+M[12]); wy += w*(M[1]*px+M[5]*py+M[9]*pz+M[13]); wz += w*(M[2]*px+M[6]*py+M[10]*pz+M[14]); }
      if (wx<min[0])min[0]=wx; if (wx>max[0])max[0]=wx;
      if (wy<min[1])min[1]=wy; if (wy>max[1])max[1]=wy;
      if (wz<min[2])min[2]=wz; if (wz>max[2])max[2]=wz;
    }
    return { min, max, playerPos: player.pos.slice() };
  },
  gl: () => gl,
  // drive a few frames with input and return state
  sampleCanvas: () => {
    const g = gl;
    const w = canvas.width, h = canvas.height;
    const px = new Uint8Array(w*h*4);
    g.readPixels(0,0,w,h,g.RGBA,g.UNSIGNED_BYTE,px);
    let nonBg = 0, sum = 0;
    const bg = [0.55,0.74,0.92];
    for (let i=0;i<px.length;i+=4){
      const r=px[i]/255, gg=px[i+1]/255, b=px[i+2]/255;
      sum += r+gg+b;
      if (Math.abs(r-bg[0])>0.03||Math.abs(gg-bg[1])>0.03||Math.abs(b-bg[2])>0.03) nonBg++;
    }
    return { nonBg, total: px.length/4, avgBrightness: sum/(px.length/4) };
  },
};

return { init, _test };
})();

window.GAME = GAME;
