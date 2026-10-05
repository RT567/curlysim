# The "runs fine, then suddenly slow forever" bug: a jammed wave train — 2026-10-05

## Symptom (Rob)
After a reload the sim runs at full speed; somewhere around 15–35 s later (varies per reload, different
on phones) it suddenly drops to about a quarter speed and never recovers until the page is reloaded.

## Cause
`WaveField.update` (src/waves.js) moves each wave's crest shoreward at the local speed c = min(√(g d), c0)
and kept it at least `0.3 * L0` (deep-water wavelength, ≈47 m at T = 10 s) behind the wave ahead. In
shallow water real crests bunch to c·T ≈ 17–40 m, so that rule held every wave behind the near-shore
ones and the jam propagated out to sea: after a couple of minutes every crest sat at ~47–51 m spacing
even 250 m offshore. Waves were also removed at a fixed world x (`DIE_X = -14`), but since the shared
seabed (02) the shoreline at the bank is x ≈ 39.5, so each wave crawled ~53 m of sand at the 0.25 m depth
floor (~1.6 m/s, ~30 s) while blocking the queue.

So the live wave count climbed after load and stayed up: default conditions 5 → 13; small short-period
swell 9 → 24 (= MAX_TRAIN, the shader loop's cap). Every ocean vertex (~450k across the tiers) loops over
every live wave in the vertex shader, so GPU time ramped up; with vsync the frame rate steps 60 → 30 →
20/15 once a frame misses its budget, which is why a gradual build-up looked like a sudden cliff, why
the moment varied per reload (random spacing) and per device, and why it never recovered (the jam is a
steady state).

Found by running waves.js + geo.js headless under node at 1/60 s steps and logging the live count and
crest gaps per minute (scratch script; easy to recreate: `new WaveField().rebuild(cond)`, loop `update`).

## Fix (src/waves.js, WaveField.update)
- Queue gap = `0.3 * c * T` (local wavelength) instead of `0.3 * L0`.
- A wave already up the sand (x < SHORE_X) holds nobody back — it's invisible swash by then.
- Remove waves at `SHORE_X + DIE_X` (14 m past the local shoreline at the bank), `SHORE_X =
  shorelineX(BANK_PEAK_Z)`.

Headless, 10 min per case — live waves / crest gaps after 10 min:
| swell | before | after |
|---|---|---|
| 1.2 m 10 s (default) | 5 → 13, all ~48 m apart | 7–8; 17, 39, 70, 94, 111, 127, 139 m (shore → sea) |
| 0.5 m 7 s | 9 → 24 (cap), ~23 m apart | ~13; 13 m near shore widening to ~70 m |
| 3 m 14 s | 3 → 6 | 3–4 |

Visible side effect: offshore crest spacing is natural again (widening seaward) instead of uniformly packed.
