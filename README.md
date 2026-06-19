# GLM-5.2 vs Claude Opus — the WebGL platformers

This repo contains the two playable games from the Tech Stackups article
[**GLM-5.2 vs Claude Opus**](https://techstackups.com/comparisons/glm-5.2-vs-opus/).

For the hands-on portion of the comparison, each model was given the same task:
**build a small, complete, playable 3D platformer in raw WebGL2 from scratch** —
no game engine, no 3D library, no build step. Both got the same Kenney CC0
Platformer Kit assets and were run with thinking effort on **high**.

This repo lets you try the results yourself.

| Folder | Built by | Game |
| ------ | -------- | ---- |
| [`opus/`](opus/) | Claude Opus 4.8 | "Oopi's Climb" |
| [`glm/`](glm/) | GLM-5.2 (Z.ai) | WebGL 3D Platformer |

## Run a game

Each game is a static site with no install step. From inside either folder:

```bash
cd opus      # or: cd glm
python3 -m http.server 8000
```

Then open <http://localhost:8000/> in a modern browser (Chrome / Firefox /
Safari with WebGL2). Controls are listed on-screen and in each folder's README.

## What's in each folder

Each game folder is the full working directory the agent produced, and has its
own `README.md` describing the game, controls, and how it works. You'll also find:

- `index.html`, `js/`, `assets/` — the game itself (Kenney CC0 platformer kit assets included).
- `test/` — the headless Playwright validation suite the agent wrote (run `npm install` first).
- `AGENTS.md` / `CLAUDE.md` — the instructions the agent worked from.
- `session/` — the recorded agent session (prompts + JSONL transcript).
- `transcript/` — a rendered HTML transcript of the run (Opus).
- `timing.log` / `timer.sh` — the timing harness used for the comparison.

`node_modules/` is omitted; run `npm install` in a folder's `test/` (and in
`glm/`) to restore the Playwright test dependencies.

## Assets & license

The 3D models are from [Kenney's Platformer Kit](https://kenney.nl/assets/platformer-kit)
(CC0). See each game's `assets/License.txt`. The game code itself was written by
the respective AI models for this comparison.
