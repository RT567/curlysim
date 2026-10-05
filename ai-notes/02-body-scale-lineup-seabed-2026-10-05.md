# 02 — your body + board for scale, crowd rules, shore-aware lineup, one seabed (2026-10-05)

Rob's goal: give the viewer things of known size to judge waves against ("look down and see your
legs and your surfboard"), and make the lineup behave like a real beach break. All of this came in one
session as a series of requests; this doc records where things ended up. bd: `curlysim-ei4`.

## What changed

**Your body (`src/body.js`, `src/board.js`).** The POV is a seated surfer (eye 0.85 m above the water),
so the posture is *sitting astride*: thighs along the deck splayed to the rails, shins hanging into the
water. Low-poly capsules plus a lap block. The rig rides the camera's smoothed water height and tilts
with the wave normal. The board heading lags your head: you can look ~55° (`BODY.headSlack`) either way
before the board swings round. Paddling (WASD/arrows) points it where you look. Hidden when
`pov.eyeHeight > 1.5` (drone/debug).
- Body tuning: `BODY` in `src/body.js` (deckY 0.10 m freeboard, hipBack 0.08, thigh 0.44, shin 0.40,
  foot 0.07, so hip to sole is 0.91 m, kneeHalf 0.30, radii). The deck sits 10 cm above the smoothed
  water. That's more freeboard than a real sat-on shortboard (mostly awash), but at 2 cm the water hid
  most of the deck.
- Look-down limit: `PITCH_MIN = -1.2` in `src/camera.js` (was -0.55, which stopped short of your knees).
  This is the only change to the controls.

**One board for everyone (`src/board.js`).** `BOARD`: 1.98 m (6'6") × 0.52 m × 0.065 m, seat 0.74 m from
the tail, whole board pitched 0.06 rad nose-up. Extruded outline plus a stringer. There's no rocker,
because bending the extrude's fan-triangulated caps warped the deck. The crowd uses the same `makeBoard`
and `makeLegs`. Before this, other surfers had `BoxGeometry(1.9, 0.12, 0.5)` boards (12 cm thick)
floating 12 cm above the water and no legs. World units were already metres.

**Crowd (`src/surfers.js`).**
- `MAX_SURFERS` is 20 (was 14) and `MIN_SURFERS` is 1, so someone is always out. The crowd model is
  otherwise unchanged.
- Surfer 0 is the "buddy", 7–16 m along the beach from you (`BUDDY_R`). Everyone else sits ≥16 m
  along-shore, in packs (`PACK_SPREAD` ±35 m) on three peaks: ours, one south, and one north (pulled in
  to stay south of the wall).
- Everyone sits at the viewer's lineup distance from the *local* shoreline, ±`LINEUP_BAND` (4.6 m).
- `MIN_GAP` 4.6 m to the viewer is enforced every frame by `_clear(home, out)`. It's computed fresh from
  each surfer's home seat, so paddling past people no longer snowplows them into a bunch (that was the
  "five surfers bunched just north of me" bug).
- If nobody is within 25 m for 4 s, the buddy re-seats on the side you're not looking at.

**North wall.** Nobody (viewer or crowd) sits north of `NORTH_SEAT_LIMIT_Z` = `NORTH_WALL_Z` + 15 m
(`src/geo.js`). `NORTH_WALL_Z` (≈ -521) is derived from the lagoon constants `LAGOON_Z`, `LAGOON_SIGMA`
and `LAGOON_EDGE`. terrain.js now imports those constants, and they make the sheer plateau wall where
the lagoon flat ends at the North Curl Curl headland.

**Physics changes Rob asked for (`src/waves.js`, `src/geo.js`).**
- `SWELL_ANGLE_FACTOR = 0.25` (waves.js) scales the swell's propagation angle off the shore normal,
  keeping the sign. This stands in for refraction: a 40° swell arrives at 10°. There's no other
  refraction step (it's one plane-crest train along `meanDir`), so it's applied once, in `rebuild()`.
- **One ground function.** `beachElevation(xs)` in geo.js gives ground height at `xs` metres seaward of
  the local still-water shoreline `shorelineX(z)` (headlands still push the coast out at the ends: it's
  39.5 m at the lineup z = -300, about 5 m mid-beach).
  - Sea floor: `-(SHELF·xs + (SHORE−SHELF)·BLEND_L·(1−e^(−xs/BLEND_L)))` with SHORE_SLOPE 1/14,
    SHELF_SLOPE 1/50 and BLEND_L 150 m.
  - Beach face: `BERM_H·(1−e^(SHORE·xs/BERM_H))` with BERM_H 1.8 m. It's C1 at the waterline.
  - Users: waves.js `depthAt` (`seaDepth`, plus a 0.25 m numerical floor) and the GLSL twin
    (`SEABED_GLSL`, generated from the same constants), and terrain.js `terrainHeight`. Dunes, hills,
    the headland cliff and the lagoon are added only inland and are 0 at the waterline.
  - The swash/shore fade in `surfaceAt` and the shader also use `xs`.
  - The old sandbar and along-shore bank are gone, so the profile is identical along the beach and
    monotonic.
- Depth vs distance from shore: 25 m → 1.7, 50 → 3.2, 100 → 5.8, 150 → 7.9, 250 → 11.3, about 21 at
  the wave spawn. The old profile at the A-frame was 50 → 0.8, 100 → 2.5, 150 → 2.4 (bar), 200 → 6.2,
  400 → 16.9, with a 0.25 m floor out to ~23 m.

**Lineup seat (`waves.js nonlinearOnsetX` / `lineupX`, `camera.js lineupX`).**
- Onset criterion: the same per-point `steep = H_full / (γ_Weggel · d)` that `surfaceAt` uses. At 0.8
  the crest starts to lean (`smoothstep(0.8, 1.0, steep)`; breaking starts at 0.95). The design wave is
  the typical biggest wave of a set, 1.3·Hs (`LINEUP_SET_F`).
- The rare max wave (~1.43 Hs) is deliberately *not* the design wave. It may stand up or break at you,
  like a clean-up set.
- The search marches in from offshore and stops at the shoreline, returning the shoreline if nothing
  goes nonlinear.
- Seat = onset + `LINEUP_MARGIN` (8 m), then hard-clamped in camera.js to ≥ 1.5 m of water
  (`SEAT_MIN_DEPTH`, ~21.7 m from shore). The 60 m fallback (`SEAT_FALLBACK`) applies if the search
  ever returns non-finite.
- `_checkSeat` warns once in the console if the seat is ever on/near land or north of the wall.
- Paddling is also clamped to that depth and to the north limit.
- Only the seat's x changes with conditions; z stays put.

Seat distance from the local shoreline (z = -300, shore-normal swell):

| Hs | T | original (xBreak−55, old bathymetry) | pure Dean A=0.17 (intermediate) | now |
|---|---|---|---|---|
| 0.5 | 8 | 70 m from x=0, ~31 m from the real shoreline | 36 | **25 m** (onset 17) |
| 1 | 9 | 70 / ~31 | 68 | **40 m** (onset 32) |
| 2 | 11 | 125 / ~86 | 147 | **70 m** (onset 62) |
| 3 | 13 | 135 / ~96 | 235 | **101 m** (onset 93) |
| 4 | 14 | 150 / ~111 | 333 | **137 m** (onset 129) |

The original code seated you *inside* the break (xBreak−55). The headland shoreline shift (39.5 m at
z = -300) wasn't known to the wave depth, which is how the viewer ended up on the sand for a while.

## Gotchas / for the next agent
- Hitting Rob's distance targets needed a 1:14–1:20 surf zone. The model's onset sits deeper than the
  textbook "breaks at d ≈ 1.3 H" because of two things: Green's-law shoaling (`D_REF` 12 m) inflates H
  by ~1.3–1.5× near the break, and the lean onset (0.8) comes before breaking. So the onset depth is
  ~2.5×Hs. A gentler 1:30 beach puts the seat ~20% further out than Rob wants.
- `_xAt`/`_sAt` and the wave-speed integration still sample z = `BANK_PEAK_Z`. The coast curves toward
  the north headland, so crest timing elsewhere is approximate (the shape uses local depth).
- Crowd home seats are `{x, z}` objects. `userData.seat` is the per-frame displaced position.
- Debug in the console: `curlysim.body`, `curlysim.surfers`, `curlysim.waveField.nonlinearOnsetX(z)`,
  `waveStates()`. The `?debug` phase colours show where waves stand up and break.
