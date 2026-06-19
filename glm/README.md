# WebGL 3D Platformer

A small, complete 3D platformer built from scratch with **raw WebGL2 + GLSL** (no game engines / 3D libraries). It parses Kenney's CC0 glTF/GLB Platformer Kit assets by hand, renders them with skinned animation, and runs solid AABB physics with a frame-rate-independent fixed timestep.

## Run it

From this folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/> in a modern browser (Chrome/Firefox/Safari with WebGL2).

It should run first try with that command.

## Controls

| Action | Keys |
|---|---|
| Move | `W` `A` `S` `D` or Arrow keys (camera-relative) |
| Jump | `Space` (with coyote-time + jump buffering) |
| Sprint | `Shift` (hold while moving) |
| Orbit camera | `Q` / `E`, or drag the mouse |
| Zoom | Mouse wheel |
| Restart | `R` |
| Toggle debug HUD | `F3` |

## Goal

Collect all the gold coins scattered across the platforms (some require a spring bounce to reach), then reach the red flag at the end to win. Avoid the spike traps — touching one (or falling off the world) respawns you at the start and counts a death.

## How it works

- `js/mat4.js` — column-major matrix / vector / quaternion math.
- `js/glb.js` — minimal glTF 2.0 GLB binary parser: chunks, accessors, node hierarchy, skins (inverse-bind matrices) and animation channels.
- `js/renderer.js` — WebGL2 renderer + GLSL shaders with vertex skinning (`uJointMatrix[8]`), half-Lambert wrap lighting, and a procedural "grass top vs dirt side" shader driven by vertex normals (the GLB textures are referenced by URI and not embedded in the files, so the game shades with lit solid colors instead).
- `js/game.js` — level layout, fixed-timestep physics with substepped axis-separated AABB collision (no tunneling), third-person follow camera, character animation state machine (idle/walk/sprint/jump/fall), coins/hazards/spring/goal, and HUD.

Assets: Kenney Platformer Kit (CC0, kenney.nl).

## Validation (automated, headless)

A Playwright-based headless test suite verifies the game end-to-end. From this folder:

```bash
npm install            # installs playwright (dev dependency for tests only)
bash test/run-all.sh   # starts the server, runs every check, tears down
```

It asserts: zero console/WebGL errors, models load, the canvas renders real geometry (not blank), fast-falling landings don't tunnel through platforms, the jump arc matches the physics, the character moves with `W`, coins update the score, collecting all coins and reaching the flag triggers a win, the character's walk animation actually drives the skeleton, the spring launches the player to the high platform, and a bot can traverse the whole level to the goal.
