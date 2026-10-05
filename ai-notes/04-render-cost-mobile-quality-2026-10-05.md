# 04: render cost, phone quality defaults, allocation-free sampling (2026-10-05)

Rob: "slow on mobile, or after it has been running a while". bd: `curlysim-647`. The "after a while"
cliff was the wave-train jam (doc 03, commit e13bda5). This doc covers the baseline-cost work that sits
on top of it, and the measurements behind both.

## Measured (Chrome on Rob's PC: RTX 3070, Linux; prod builds via `vite preview`)

Instrumented by an init script on the page: rAF frames per 5 s, an `EXT_disjoint_timer_query_webgl2`
GPU time per frame, `renderer.info`, live wave count, scene child count, JS heap.

- **No leaks.** Over 5 min (and 30x-accelerated timers, i.e. 20 refreshes and 60 crowd re-populates)
  geometries, textures, programs, scene children, listeners, intervals and rAF callbacks per frame all
  stay flat. JS heap is flat after load. Exactly one rAF loop.
- **The only thing that grew was the live wave count**: 11 → 24 (MAX_TRAIN) by ~2 min at T = 6.5 s,
  with every crest 20 m apart and moving at ~1.6 m/s even 300 m out (doc 03). Headless estimate of
  vertex-shader work: ~6.7 full wave evaluations per vertex when jammed vs ~3.2 when fixed (about 2x).
- Desktop is vsync-bound at 60 fps before and after. The 3070 needs about 1 ms of GPU per frame, so it
  never showed the cliff as FPS. A phone GPU is roughly 20–40x slower, which is why phones fall off it.
- JS per frame is small: about 0.2 ms in total for waves, sky, camera, body and crowd, plus about 0.5 ms
  for the render call on desktop (2 ms with 4x CPU throttling).

| | before (910b432) | after |
|---|---|---|
| live waves at 5 min (T 6.5 s) | 24 (jammed) | 14 |
| ocean vertices shaded / frame, desktop | 455,604 always (`frustumCulled=false`) | 69k facing beach, 233k along beach, 346k out to sea |
| ocean vertices / frame, phone portrait | 455,604 | 22k beach, 84k along, 95k sea (grid x0.7) |
| triangles drawn, desktop facing beach | 1.23 M | 0.46 M |
| phone pixel ratio (DPR 3) | 2 | 1.5, adaptive down to 0.75 |
| draw calls per crowd surfer | 11 | 4 |
| JS heap after load (desktop) | ~143 MB | ~127 MB |

## Changes
- **Tiled, culled ocean** (`ocean.js`). The four ocean meshes were drawn with frustum culling off, so all
  ~456k vertices ran the 24-wave vertex shader every frame, including everything behind you. Each tier is
  now a grid of tiles (near 4x6, sea 3x3, north/south 1x3) built by `gridTile` from global indices, so
  tile edges are bit-identical and there are no seams. It's the same grid and the same diagonal as the
  old PlaneGeometry. Bounds are padded 25 m for wave lift/lean. The geometry has positions only.
- **Depth as a varying.** The fragment shader read `depthAt` (6 exps) per pixel. It's now computed per
  vertex at the displaced point and interpolated. Visually the same.
- **Phone defaults** (`quality.js`, `(pointer: coarse)` or a screen under 820 px): pixel ratio cap 1.5
  (desktop keeps 2), ocean grid density x0.7. Desktop looks unchanged.
- **Adaptive pixel ratio** (`AdaptiveQuality`). If FPS stays under 40 in a 2 s window, the pixel ratio
  steps down x0.8 (to a minimum of 0.75). If a step doesn't raise FPS by 8% (a 30 Hz cap such as iOS Low
  Power Mode, or a CPU-bound device), it reverts and locks. It never steps back up. It ignores the first
  4 s, and any window with a >250 ms hitch or a hidden tab. Console: `curlysim.quality`.
- **Crowd draw calls.** Legs, torso and head are merged into one wetsuit geometry and one skin geometry
  (`body.js legParts/mergeParts`). Each surfer is hull + stringer + wetsuit + skin, so 20 surfers are
  80 calls instead of 220. The viewer's legs are 2 meshes instead of 7. Shapes and sizes are unchanged.
- **Allocation-free per-frame sampling.** `surfaceAt(x, z, out)`, `heightAt` uses a scratch object,
  and `normalAt(..., out)`. Camera, body and crowd pass scratch normals. `shorelineX` uses one exp
  instead of exp+pow (same value, as in the GLSL twin).
- `sky.js`: the SunCalc ephemeris is recomputed at most once per sim-second, with no Vector3/object
  allocation per frame. `weather.js`: the rain loop writes the typed array directly.
- `surfers.populate` runs the lineup search once per populate instead of once per surfer.
- `terrain.js`: dropped the unused `uv` attribute (~8 MB of the non-indexed patches).

## Open / for Rob
- **e13bda5 removes waves at `SHORE_X + DIE_X` (x ≈ 25.5).** The shoreline is 3–17 m mid-beach
  (z = 0 … -200), so there a bore vanishes 10–20 m out in ~1.5 m of water. Headless, the dying wave's
  height there is **0.23–0.37 m at the moment it's removed** (a visible pop along the beach to your
  south). With the old world `DIE_X` (-14) and the local-wavelength queue kept, there's no pop and no
  jam (0% of offshore waves held back across T 4–18 s, Hs 0.5–3.5). That costs ~3–5 more live waves
  (all on the sand at the bank's z). Suggest reverting just that line.
- The buddy re-seats on the lineup line, not next to you. If you paddle more than 25 m off the line, he
  re-seats every 4 s (cheap, but he teleports). This is d3402ad behaviour, left as is.
- Prefill in `rebuild` can exceed MAX_TRAIN (27 at T = 4 s). The shader sees the first 24 and the CPU
  sees all of them.
- Not tested on a real phone. GPU cost per frame should be measured there (Safari has no timer query;
  use FPS).
