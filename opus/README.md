# Oopi's Climb — a 3D platformer in raw WebGL

A small, complete, playable 3D platformer that runs in the browser. Built
**from scratch**: no game engine and no 3D library. Everything (the GLB/glTF
loader, the matrix/vector math, the renderer, the skeletal animation, the
physics and collision) is hand-written plain JavaScript with hand-written GLSL
shaders running on **WebGL2**. There is no build step.

## Run it

From this folder, start any static file server and open the page. The simplest:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/> in a browser (Chrome/Edge/Firefox/Safari).

That's the only command needed — there is nothing to install or build.

## Controls

| Action            | Keys                          |
| ----------------- | ----------------------------- |
| Move              | `W` `A` `S` `D` or arrow keys |
| Run               | hold `Shift`                  |
| Jump              | `Space`                       |
| Orbit the camera  | click + drag the mouse        |
| Zoom              | mouse wheel                   |
| Restart           | `R`                           |

## The goal

Cross the gaps, climb the stairs and the floating islands, grab the coins and
the jewel along the way (your score is shown top-left), avoid the spike block,
and reach the **flag** at the top to win. Falling off the world or touching a
hazard respawns you at the start.

## How it works (all hand-written)

- **`js/math.js`** — `vec3`, `quat` (with slerp) and column-major `mat4`
  (perspective, lookAt, invert, TRS compose, etc.).
- **`js/gltf.js`** — a GLB container parser and a glTF 2.0 accessor decoder
  (handles every component type and interleaved buffer views via `byteStride`).
  The Kenney assets are parsed directly; nothing is pre-converted.
- **`js/model.js`** — turns parsed glTF into GPU buffers. `StaticModel` bakes
  each node's transform for the level pieces; `SkinnedModel` builds the
  character's skinned mesh, computes joint matrices from the node hierarchy and
  inverse-bind matrices, and samples the baked animation clips
  (`idle`/`walk`/`sprint`/`jump`/`fall`) with linear/slerp interpolation.
- **`js/renderer.js`** — WebGL2 setup and two GLSL programs (a static program
  and a GPU-skinning program), simple directional + ambient lighting, and the
  shared Kenney `colormap` palette texture.
- **`js/level.js`** — the level layout. Each platform is authored once as both a
  rendered asset placement **and** the axis-aligned box used for collision, so
  what you see is exactly what you collide with.
- **`js/player.js`** — frame-rate-independent movement, gravity and a consistent
  jump arc, with **swept** axis-by-axis AABB collision (you stand on platforms,
  can't tunnel through them even falling fast, and can't pass through walls).
  Includes coyote-time and jump-buffering for good movement feel.
- **`js/main.js`** — the game loop, third-person follow/orbit camera, input,
  coin collection + score, hazards, and win/lose state.

## Verifying it works

A headless self-test lives in `test/`. It serves the game, loads it in headless
Chromium, and asserts the whole thing end to end — no console/page/WebGL errors,
the canvas actually renders recognizable geometry, the GLB assets parsed into
geometry, the character moves, the jump arc is frame-rate independent, collision
is solid (lands on platforms, crosses gaps, no tunneling at high speed), the
camera follows, coins score, the flag wins, and the hazard kills.

```bash
cd test
npm install          # installs playwright (test-only; the game itself needs nothing)
npx playwright install chromium
node verify.mjs
```

The game exposes `window.__game` so the test (or you, from the console) can
inspect and drive its state. `test/screenshot.png` is a capture from the last
run.
