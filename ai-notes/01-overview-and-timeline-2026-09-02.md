# curlysim — POV surf simulator of North Curl Curl in live conditions

Live: https://rt567.github.io/curlysim/  ·  Repo: github.com/RT567/curlysim (branch `main`)

## The idea

Sit "out the back" at North Curl Curl (Sydney) in a browser, in the **actual current conditions**: real swell height/period/direction and wind from Open-Meteo (marine + forecast APIs, refreshed every 15 min), real sun/moon position (suncalc), crowd size derived from conditions and time of day/week. No HUD, no UI — drag to look around and wait for a set like everyone else. Three.js + Vite. Add `?debug` for a lil-gui panel with condition overrides and a clock scrubber. See `README.md` for the physics summary.

## Timeline

| date | commit / event |
|---|---|
| 2026-09-01 | v1: live-conditions POV sim. Beads initialised. |
| 2026-09-01 | Physics v2: discrete wave trains over real bathymetry. |
| 2026-09-01 | Calibrated breaker physics: Weggel gamma, Iribarren plunge, real sandbar. |
| 2026-09-01 | Fixed far-mesh poke-through (flat-plane artifact), continuous breaking. |
| 2026-09-01 | Finer far-strip meshes (distant surf no longer aliases into shards). |
| 2026-09-01 | Seat depth floor so small days don't spawn you in the shore wash. |
| 2026-09-01 | Realistic waterline: swash runup sheet, waves die on the sand. |
| 2026-09-02 | "Full realism": Rayleigh wave statistics, real sets/lulls, live-data sizes. |
| 2026-09-02 | Tab title shortened from "curlysim — out the back at Curl Curl" to just **"curlysim"** (owner request). |

## Layout

```
index.html        <- Vite entry, <script type="module" src="/src/main.js">, <title>curlysim</title>
src/main.js       <- bootstraps scene, loop
src/ocean.js      <- wave field / breaking
src/conditions.js <- Open-Meteo fetch + derived params
src/sky.js, camera.js, terrain.js, trees.js, surfers.js, geo.js, debug.js
vite.config.js    <- base './'
.github/workflows/deploy.yml
```

## Deploy (this is NOT a plain static repo)

GitHub Pages for this repo is **workflow-based** (`build_type: workflow`). `.github/workflows/deploy.yml` runs on every push to `main`: `npm ci && npm run build` → uploads `dist/` → `actions/deploy-pages`. `dist/` is *not* committed. The live page references `./assets/index-<hash>.js`. So:

- Editing `index.html`/`src/*` and pushing is enough; wait ~1–2 min for the Action.
- Check with `gh run list -R RT567/curlysim -L 1` or `curl -s https://rt567.github.io/curlysim/ | grep '<title>'`.
- `npm install && npm run dev` for local; `npm run build` to check the build passes before pushing.

## Conventions

Uses Beads (`bd`) for issues — see `AGENTS.md`/`CLAUDE.md`. Commits are descriptive one-liners about the physics change. Owner cares about realism of the water more than UI.
