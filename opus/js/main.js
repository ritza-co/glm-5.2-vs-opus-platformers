// Game entry point: loads assets, builds the level, runs the fixed-timestep
// game loop, drives the third-person follow camera, handles input, collectibles,
// hazards, and win/lose state. Exposes window.__game for headless self-tests.

import { mat4, vec3, quat } from './math.js';
import { loadGLB } from './gltf.js';
import { StaticModel, SkinnedModel } from './model.js';
import { Renderer } from './renderer.js';
import { buildLevel, ASSET_TOP } from './level.js';
import { Player } from './player.js';

const ASSET_DIR = 'assets/GLB/';
const TEXTURE_URL = 'assets/GLB/Textures/colormap.png';
const CHARACTER = 'character-oopi';

// Map player movement state -> animation clip name.
const STATE_TO_CLIP = {
  idle: 'idle', walk: 'walk', run: 'sprint', jump: 'jump', fall: 'fall',
};

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.staticModels = new Map(); // asset name -> StaticModel
    this.character = null;
    this.level = null;
    this.player = null;
    this.score = 0;
    this.totalCoins = 0;
    this.won = false;
    this.dead = false;
    this.deathTimer = 0;
    this.animTime = 0;

    // Camera state (orbit/follow).
    this.camYaw = 0;           // camera behind player, looking into the level (-Z)
    this.camPitch = 0.35;
    this.camDist = 7.0;
    this.camTarget = vec3.fromValues(0, 0, 0);
    this.camPos = vec3.fromValues(0, 5, 10);

    this.proj = mat4.create();
    this.view = mat4.create();

    this.input = { forward: false, back: false, left: false, right: false, jump: false, run: false };
    this._mouseDown = false;

    // Self-test diagnostics.
    this.frameCount = 0;
    this.ready = false;
    this.glError = 0;
    this.lastTime = 0;
  }

  async load() {
    // Load shared texture.
    const img = await loadImage(TEXTURE_URL);
    this.renderer.createTexture(img);

    // Build the level definition first so we know which assets to load.
    this.level = buildLevel();
    this.totalCoins = this.level.coins.length;
    this.player = new Player(this.level.spawn, this.level.platforms);

    // Gather unique asset names needed.
    const names = new Set();
    for (const p of this.level.platforms) names.add(p.asset);
    for (const c of this.level.coins) names.add(c.asset);
    for (const h of this.level.hazards) names.add(h.asset);
    names.add(this.level.flag.asset);

    // Load every static asset.
    await Promise.all([...names].map(async (name) => {
      const gltf = await loadGLB(ASSET_DIR + name + '.glb');
      this.staticModels.set(name, new StaticModel(this.renderer.gl, gltf));
    }));

    // Load the rigged character.
    const charGltf = await loadGLB(ASSET_DIR + CHARACTER + '.glb');
    this.character = new SkinnedModel(this.renderer.gl, charGltf);

    this._bindInput();
    this.ready = true;
  }

  _bindInput() {
    const keymap = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'jump',
      ShiftLeft: 'run', ShiftRight: 'run',
    };
    window.addEventListener('keydown', (e) => {
      if (keymap[e.code]) { this.input[keymap[e.code]] = true; e.preventDefault(); }
      if (e.code === 'KeyR') this._reset();
    });
    window.addEventListener('keyup', (e) => {
      if (keymap[e.code]) { this.input[keymap[e.code]] = false; e.preventDefault(); }
    });

    // Mouse drag to orbit the camera.
    this.canvas.addEventListener('mousedown', () => { this._mouseDown = true; });
    window.addEventListener('mouseup', () => { this._mouseDown = false; });
    window.addEventListener('mousemove', (e) => {
      if (this._mouseDown) {
        this.camYaw -= e.movementX * 0.005;
        this.camPitch = clamp(this.camPitch - e.movementY * 0.005, 0.05, 1.3);
      }
    });
    // Scroll to zoom.
    this.canvas.addEventListener('wheel', (e) => {
      this.camDist = clamp(this.camDist + e.deltaY * 0.01, 3.5, 14);
      e.preventDefault();
    }, { passive: false });
  }

  _reset() {
    this.player.respawn();
    this.score = 0;
    this.won = false;
    this.dead = false;
    this.deathTimer = 0;
    for (const c of this.level.coins) c.collected = false;
  }

  // Public method usable by tests / programmatic control.
  setInput(partial) {
    Object.assign(this.input, partial);
  }

  step(dt) {
    // Clamp dt for stability (frame-rate independence with a max step).
    dt = Math.min(dt, 1 / 30);

    if (this.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) { this.player.respawn(); this.dead = false; }
    } else if (!this.won) {
      this.player.update(this.input, this.camYaw, dt);
      this._checkCoins();
      this._checkHazards();
      this._checkFlag();
    }

    this.animTime += dt;
    this._updateCamera(dt);
    this.frameCount++;
  }

  _checkCoins() {
    const px = this.player.pos[0], py = this.player.pos[1] + 0.45, pz = this.player.pos[2];
    for (const c of this.level.coins) {
      if (c.collected) continue;
      const dx = px - c.x, dy = py - c.y, dz = pz - c.z;
      if (dx * dx + dy * dy + dz * dz < c.radius * c.radius) {
        c.collected = true;
        this.score += c.value;
      }
    }
  }

  _checkHazards() {
    const b = this.player._aabb();
    for (const h of this.level.hazards) {
      const a = h.aabb;
      if (b.maxX > a.minX && b.minX < a.maxX &&
          b.maxZ > a.minZ && b.minZ < a.maxZ &&
          b.minY < a.maxY && b.maxY > a.minY) {
        this._die();
        return;
      }
    }
  }

  _die() {
    if (this.dead) return;
    this.dead = true;
    this.deathTimer = 0.8;
  }

  _checkFlag() {
    const f = this.level.flag;
    const dx = this.player.pos[0] - f.x;
    const dz = this.player.pos[2] - f.z;
    const dy = this.player.pos[1] - f.y;
    if (dx * dx + dz * dz < f.radius * f.radius && Math.abs(dy) < 1.5) {
      this.won = true;
    }
  }

  _updateCamera(dt) {
    // Target a point slightly above the player.
    const tx = this.player.pos[0];
    const ty = this.player.pos[1] + 1.0;
    const tz = this.player.pos[2];
    // Smoothly follow.
    const smooth = 1 - Math.pow(0.001, dt);
    this.camTarget[0] += (tx - this.camTarget[0]) * smooth;
    this.camTarget[1] += (ty - this.camTarget[1]) * smooth;
    this.camTarget[2] += (tz - this.camTarget[2]) * smooth;

    // Spherical offset from target.
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const ox = Math.sin(this.camYaw) * cp * this.camDist;
    const oy = sp * this.camDist;
    const oz = Math.cos(this.camYaw) * cp * this.camDist;
    this.camPos[0] = this.camTarget[0] + ox;
    this.camPos[1] = this.camTarget[1] + oy;
    this.camPos[2] = this.camTarget[2] + oz;
  }

  render() {
    const aspect = this.renderer.resize();
    mat4.perspective(this.proj, (60 * Math.PI) / 180, aspect, 0.1, 200);
    mat4.lookAt(this.view, this.camPos, this.camTarget, [0, 1, 0]);

    this.renderer.beginFrame();
    const gl = this.renderer.gl;

    // Draw platforms.
    const m = mat4.create();
    const scaleM = mat4.create();
    const transM = mat4.create();
    for (const p of this.level.platforms) {
      // Place asset so its top aligns to topY: translate to (cx, renderY, cz).
      mat4.fromTranslation(transM, [p.cx, p.renderY, p.cz]);
      this.renderer.drawStatic(this.staticModels.get(p.asset), this.proj, this.view, transM);
    }

    // Draw hazards.
    for (const h of this.level.hazards) {
      mat4.fromTranslation(transM, [h.x, h.y, h.z]);
      this.renderer.drawStatic(this.staticModels.get(h.asset), this.proj, this.view, transM);
    }

    // Draw the flag.
    {
      const f = this.level.flag;
      mat4.fromTranslation(transM, [f.x, f.y, f.z]);
      const tint = this.won ? [0.6, 1.0, 0.6, 1] : [1, 1, 1, 1];
      this.renderer.drawStatic(this.staticModels.get(f.asset), this.proj, this.view, transM, tint);
    }

    // Draw coins (spinning, hovering, emissive).
    for (const c of this.level.coins) {
      if (c.collected) continue;
      const spin = this.animTime * 2.5;
      const bob = Math.sin(this.animTime * 3 + c.x) * 0.12;
      mat4.fromYRotation(m, spin);
      m[12] = c.x; m[13] = c.y + bob; m[14] = c.z;
      this.renderer.drawStatic(this.staticModels.get(c.asset), this.proj, this.view, m, [1, 1, 1, 1], 0.6);
    }

    // Draw the character with its current animation pose.
    const clip = STATE_TO_CLIP[this.player.state] || 'idle';
    this.character.pose(clip, this.animTime);
    const charM = mat4.create();
    const rot = mat4.create();
    mat4.fromYRotation(rot, this.player.facing);
    mat4.fromTranslation(charM, [this.player.pos[0], this.player.pos[1], this.player.pos[2]]);
    mat4.multiply(charM, charM, rot);
    const tint = this.dead ? [1, 0.4, 0.4, 1] : [1, 1, 1, 1];
    this.renderer.drawSkinned(this.character, this.proj, this.view, charM, this.character.jointMatrices, tint);

    // Track GL errors for the self-test.
    const err = gl.getError();
    if (err !== gl.NO_ERROR) this.glError = err;

    this._updateHUD();
  }

  _updateHUD() {
    const hud = document.getElementById('score');
    if (hud) hud.textContent = `Score: ${this.score}   Coins: ${this.collectedCount()}/${this.totalCoins}`;
    const banner = document.getElementById('banner');
    if (banner) {
      if (this.won) { banner.textContent = '🏁 You reached the flag! You win!  (press R to play again)'; banner.style.display = 'block'; }
      else if (this.dead) { banner.textContent = '💥 Ouch! Respawning...'; banner.style.display = 'block'; }
      else { banner.style.display = 'none'; }
    }
  }

  collectedCount() {
    return this.level.coins.filter((c) => c.collected).length;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image ' + url));
    img.src = url;
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// --- Bootstrap -------------------------------------------------------------
async function boot() {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  window.__game = game; // expose for headless tests / self-test hooks
  try {
    await game.load();
  } catch (err) {
    console.error('Asset load failed:', err);
    document.getElementById('banner').textContent = 'Load error: ' + err.message;
    document.getElementById('banner').style.display = 'block';
    throw err;
  }

  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    game.step(dt);
    game.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
