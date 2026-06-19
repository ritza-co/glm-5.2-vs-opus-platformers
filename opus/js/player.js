// Player controller: frame-rate-independent movement, gravity, jumping, and
// solid AABB collision against the level platforms. The player is modeled as
// an axis-aligned box; collision is resolved axis-by-axis with swept vertical
// checks so the player never tunnels through a platform when falling fast.

import { vec3 } from './math.js';

const GRAVITY = 26.0;          // units / s^2
const MOVE_SPEED = 5.5;        // walk speed (units/s)
const RUN_SPEED = 9.0;         // shift to run
const JUMP_SPEED = 10.5;       // initial jump velocity -> consistent arc
const ACCEL = 60.0;            // ground acceleration
const AIR_ACCEL = 18.0;        // reduced air control
const FRICTION = 12.0;         // ground damping when no input
const MAX_FALL = 40.0;         // terminal velocity (clamp)
const COYOTE_TIME = 0.10;      // grace period to jump after leaving ground
const JUMP_BUFFER = 0.12;      // remember a jump press briefly

// Player AABB half extents (roughly the character's footprint & height).
const HALF_W = 0.32;
const HEIGHT = 0.9;

export class Player {
  constructor(spawn, platforms) {
    this.pos = vec3.fromValues(spawn.x, spawn.y, spawn.z);
    this.vel = vec3.fromValues(0, 0, 0);
    this.platforms = platforms;
    this.grounded = false;
    this.facing = Math.PI; // yaw, radians; start facing into the level (-Z)
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.spawn = { ...spawn };
    this.state = 'idle'; // idle | walk | run | jump | fall
    this.speedXZ = 0;
  }

  respawn() {
    vec3.set(this.pos, this.spawn.x, this.spawn.y, this.spawn.z);
    vec3.set(this.vel, 0, 0, 0);
    this.grounded = false;
  }

  // input: { forward, back, left, right, jump, run }  (booleans)
  // camYaw: camera yaw so movement is camera-relative.
  // dt: seconds (clamped by caller).
  update(input, camYaw, dt) {
    // --- Desired horizontal direction in world space (camera-relative) ---
    // Forward (into screen) is -Z rotated by camera yaw.
    let ix = 0, iz = 0;
    if (input.forward) iz -= 1;
    if (input.back) iz += 1;
    if (input.left) ix -= 1;
    if (input.right) ix += 1;

    let wantX = 0, wantZ = 0;
    const hasInput = ix !== 0 || iz !== 0;
    if (hasInput) {
      // Rotate input by camera yaw.
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      // Camera-forward (-Z) and camera-right (+X) in world.
      const fwdX = -sin, fwdZ = -cos;
      const rightX = cos, rightZ = -sin;
      wantX = rightX * ix + fwdX * (-iz);
      wantZ = rightZ * ix + fwdZ * (-iz);
      const len = Math.hypot(wantX, wantZ);
      if (len > 0) { wantX /= len; wantZ /= len; }
      this.facing = Math.atan2(wantX, wantZ);
    }

    const targetSpeed = input.run ? RUN_SPEED : MOVE_SPEED;
    const accel = this.grounded ? ACCEL : AIR_ACCEL;

    // Accelerate horizontal velocity toward target.
    const targetVX = wantX * targetSpeed;
    const targetVZ = wantZ * targetSpeed;
    if (hasInput) {
      this.vel[0] += (targetVX - this.vel[0]) * Math.min(1, accel * dt / targetSpeed);
      this.vel[2] += (targetVZ - this.vel[2]) * Math.min(1, accel * dt / targetSpeed);
    } else if (this.grounded) {
      // Friction.
      const damp = Math.max(0, 1 - FRICTION * dt);
      this.vel[0] *= damp;
      this.vel[2] *= damp;
      if (Math.hypot(this.vel[0], this.vel[2]) < 0.05) { this.vel[0] = 0; this.vel[2] = 0; }
    }

    // --- Jump handling with coyote time + input buffering ---
    if (input.jump) this.jumpBuffer = JUMP_BUFFER; else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.grounded) this.coyote = COYOTE_TIME; else this.coyote = Math.max(0, this.coyote - dt);

    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel[1] = JUMP_SPEED;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }

    // --- Gravity ---
    this.vel[1] -= GRAVITY * dt;
    if (this.vel[1] < -MAX_FALL) this.vel[1] = -MAX_FALL;

    // --- Integrate + collide, axis by axis ---
    this._moveAxis(0, this.vel[0] * dt);
    this._moveAxis(2, this.vel[2] * dt);
    this._moveVertical(this.vel[1] * dt);

    // Fell off the world -> respawn.
    if (this.pos[1] < -12) this.respawn();

    // --- State for animation selection ---
    this.speedXZ = Math.hypot(this.vel[0], this.vel[2]);
    if (!this.grounded) {
      this.state = this.vel[1] > 0.5 ? 'jump' : 'fall';
    } else if (this.speedXZ > RUN_SPEED * 0.6) {
      this.state = 'run';
    } else if (this.speedXZ > 0.4) {
      this.state = 'walk';
    } else {
      this.state = 'idle';
    }
  }

  // Returns the player's AABB at the current position.
  _aabb(px = this.pos[0], py = this.pos[1], pz = this.pos[2]) {
    return {
      minX: px - HALF_W, maxX: px + HALF_W,
      minY: py, maxY: py + HEIGHT,
      minZ: pz - HALF_W, maxZ: pz + HALF_W,
    };
  }

  // Horizontal collision: move along axis (0=X, 2=Z), then push out of any
  // platform we overlap on the sides. We only block horizontally against the
  // vertical faces of blocks the player would actually run into (feet-to-head
  // overlap with the block's solid box).
  _moveAxis(axis, delta) {
    this.pos[axis] += delta;
    const box = this._aabb();
    for (const p of this.platforms) {
      const a = p.aabb;
      // Vertical overlap: player's body must intersect the block's solid span.
      if (box.maxY <= a.bottomY + 0.001 || box.minY >= a.topY - 0.001) continue;
      // Horizontal overlap on both axes?
      const overlapX = box.maxX > a.minX && box.minX < a.maxX;
      const overlapZ = box.maxZ > a.minZ && box.minZ < a.maxZ;
      if (!(overlapX && overlapZ)) continue;

      // Resolve along the moving axis.
      if (axis === 0) {
        if (delta > 0) this.pos[0] = a.minX - HALF_W - 0.0005;
        else if (delta < 0) this.pos[0] = a.maxX + HALF_W + 0.0005;
        this.vel[0] = 0;
      } else {
        if (delta > 0) this.pos[2] = a.minZ - HALF_W - 0.0005;
        else if (delta < 0) this.pos[2] = a.maxZ + HALF_W + 0.0005;
        this.vel[2] = 0;
      }
      box.minX = this.pos[0] - HALF_W; box.maxX = this.pos[0] + HALF_W;
      box.minZ = this.pos[2] - HALF_W; box.maxZ = this.pos[2] + HALF_W;
    }
  }

  // Vertical movement with swept check to prevent tunneling at high fall speed.
  _moveVertical(delta) {
    const startY = this.pos[1];
    const endY = startY + delta;
    this.grounded = false;

    if (delta <= 0) {
      // Falling (or stationary): find the highest platform top we cross.
      let landY = -Infinity;
      let landed = false;
      for (const p of this.platforms) {
        const a = p.aabb;
        // Horizontal footprint overlap?
        if (this.pos[0] + HALF_W <= a.minX || this.pos[0] - HALF_W >= a.maxX) continue;
        if (this.pos[2] + HALF_W <= a.minZ || this.pos[2] - HALF_W >= a.maxZ) continue;
        // Feet crossed this top during the step? (swept, so fast falls still catch)
        const feetStart = startY;
        const feetEnd = endY;
        if (feetStart >= a.topY - 0.02 && feetEnd <= a.topY) {
          if (a.topY > landY) { landY = a.topY; landed = true; }
        }
      }
      if (landed) {
        this.pos[1] = landY;
        this.vel[1] = 0;
        this.grounded = true;
        return;
      }
      this.pos[1] = endY;
    } else {
      // Moving up: check head against the bottom of any block above.
      let hitY = Infinity;
      let hit = false;
      const headStart = startY + HEIGHT;
      const headEnd = endY + HEIGHT;
      for (const p of this.platforms) {
        const a = p.aabb;
        if (this.pos[0] + HALF_W <= a.minX || this.pos[0] - HALF_W >= a.maxX) continue;
        if (this.pos[2] + HALF_W <= a.minZ || this.pos[2] - HALF_W >= a.maxZ) continue;
        if (headStart <= a.bottomY + 0.001 && headEnd >= a.bottomY) {
          if (a.bottomY < hitY) { hitY = a.bottomY; hit = true; }
        }
      }
      if (hit) {
        this.pos[1] = hitY - HEIGHT - 0.001;
        this.vel[1] = 0;
        return;
      }
      this.pos[1] = endY;
    }
  }
}

export const PLAYER_HALF_W = HALF_W;
export const PLAYER_HEIGHT = HEIGHT;
