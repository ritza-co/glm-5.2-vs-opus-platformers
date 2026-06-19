# Task: Build a 3D platformer game from scratch in WebGL

## FIRST STEP — start the timer (do this before anything else)

Before you read further or write any code, run this once to record your start time:

```bash
./timer.sh start
```

This writes to `timing.log`. You will run `./timer.sh end` as the very last step, only after the task is fully complete and verified (see "Work until it is actually done" below). These timestamps are how we measure how long the build took, so the start call must come before you begin and the end call must come after everything works.

---

Build a small but complete, playable **3D platformer game** that runs in the browser. Build it **from scratch**: no game engines or 3D libraries (no Three.js, Babylon.js, PlayCanvas, etc.). Use **raw WebGL** (WebGL2 is fine) and hand-written GLSL shaders only. Plain JavaScript/HTML; no build step.

## What to build

A playable platformer with:

1. **A rendered 3D world** built from the provided assets — ground/platforms the player can stand on, arranged into a small level with some gaps and height changes to jump across.
2. **A controllable character** (one of the provided animated character models) that the player moves around the level.
3. **Movement + physics:** walk/run with `WASD` (or arrow keys), `Space` to jump, gravity, and **solid collision** with the platforms (the character stands on top of platforms and cannot fall through them or pass through walls).
4. **A camera** that follows the character (third-person follow or orbit).
5. **At least one game goal:** e.g. collect the coins/gems scattered on the platforms, reach a flag, or avoid a hazard. Show a simple score or win state.

Make it actually fun to move around in. Movement feel matters (frame-rate-independent, consistent jump arc, no jitter).

## Assets (provided — use these)

Everything is in `assets/GLB/` as **glTF/GLB** files (Kenney "Platformer Kit", CC0, free to use). One coherent low-poly art style. Key files:

- **Animated characters** (rigged + skinned, with baked animation clips such as `idle`, `walk`, `sprint`, `jump`, `fall`, `crouch`):
  `character-oopi.glb`, `character-oobi.glb`, `character-oodi.glb`, `character-ooli.glb`, `character-oozi.glb`
- **Terrain / platforms:** `block-grass-*.glb` (many shapes: large, low, slopes, curves, corners, hexagons, overhangs), `platform.glb`, `platform-ramp.glb`, `platform-overhang.glb`, `platform-fortified.glb`, `spring.glb`, `conveyor-belt.glb`
- **Collectibles:** `coin-gold.glb`, `coin-silver.glb`, `coin-bronze.glb`, `jewel.glb`, `star.glb`, `heart.glb`, `key.glb`, `chest.glb`
- **Hazards:** `spike-block.glb`, `trap-spikes.glb`, `saw.glb`, `bomb.glb`
- **Props/scenery:** `flag.glb`, `sign.glb`, `crate.glb`, `barrel.glb`, `ladder.glb`, `door-open.glb`, `fence-*.glb`, `flowers.glb`, `mushrooms.glb`, `rocks.glb`, `plant.glb`

Use as many or as few as you need to make a good level. You must load the GLB files yourself (parse the glTF/GLB format) — do not convert them with an external tool.

Playing the character's baked animations (idle/walk/jump) is a plus and makes it feel alive, but a statically-rendered character that moves and jumps correctly is acceptable if animation is too much.

## Rules / constraints

- **No 3D or game-engine libraries.** Raw WebGL + GLSL only. (You may write small helper code yourself, e.g. a minimal matrix/vector math file.)
- Runs in a normal browser, served with a single command. A simple static server is fine (e.g. `python3 -m http.server`); document the exact command in a `README.md`.
- Plain JS/HTML/CSS, no bundler/build step required.
- Keep everything inside this folder.

## Deliverables

- The full source for the game in this folder.
- A `README.md` with the one command to run it and the controls.
- It should run first try with that command.

## Work until it is actually done — validate your own work

Do **not** stop when the code is merely written. Keep working until the game genuinely works end to end, and prove it to yourself before declaring done. Iterate: build → run → observe → find the bug → fix → re-test, repeatedly, until all the checks below pass.

**Set up a way to verify the game actually runs and behaves correctly**, for example:
- Start the static server and load the page; check the **browser console and the WebGL context for errors** (shader compile/link errors, GL errors, failed asset loads, 404s, uncaught JS exceptions). Zero errors is the bar.
- Write a small **automated check** where practical — e.g. a headless-browser script (Puppeteer/Playwright) or an in-page self-test that loads the game, advances several frames, and asserts: the canvas is rendering (not blank/black), the GLB assets parsed and produced geometry, no console/GL errors occurred, and the physics step runs. Use whatever validation method is most reliable; if you can drive it headlessly, do so.
- Add temporary debug logging / on-screen readouts (FPS, player position, "grounded" state, collision results) to confirm the systems behave, then you can quiet them once verified.

**Definition of done — every item must be true and verified by you, not assumed:**
1. Runs first try with the documented command, no console or WebGL errors.
2. The level renders correctly from the GLB assets (recognizable geometry, lit/shaded — not a blank canvas, not garbled triangles).
3. The character is visible and moves with the documented controls.
4. Gravity + jumping work and feel consistent (frame-rate-independent; jump arc is the same regardless of FPS).
5. **Collision is solid:** the character stands on platforms, does **not** fall through them (no tunneling, even when falling fast), and does not stick/jitter against surfaces. Explicitly test landing on a platform and jumping across a gap.
6. The camera follows the character without flipping or breaking.
7. The game goal works (e.g. collecting a coin updates the score; reaching the flag / dying triggers the win/lose state).

If something fails a check, fix it and re-run the checks. Only report the task complete once you have personally verified all seven items pass.

## LAST STEP — stop the timer

Once, and only once, all seven Definition-of-Done items pass and the game is fully working, run:

```bash
./timer.sh end
```

This records the end time and elapsed duration to `timing.log`. Do **not** run it earlier — it marks the moment the finished, verified game was done. Then, in your final message, briefly state how you validated each of the seven items (what you ran, what you observed) and report the elapsed time it printed.
