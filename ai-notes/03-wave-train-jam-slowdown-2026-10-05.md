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

## Crowd spread along the whole beach (same day)
Rob: "always people sitting north, very few sitting south". North/south were not swapped (yaw 0 faces the
beach; the close North Curl Curl wall, z ≈ −521, is on your right; the far South Curl Curl headland is
HEADLANDS[0] at z 650). The viewer sits at BANK_PEAK_Z = −300, ~220 m from the north wall, and populate()
only used three peaks (ours, a clamped north one, −76), so everyone landed in z −406…−42: bunched between
you and the near headland, nothing down the south half.
Now: `SOUTH_SEAT_LIMIT_Z = HEADLANDS[0].z − 1.75·sz` (≈ 300, where the south headland starts pushing the
shoreline out); packs on every sandbank peak whose ±PACK_SPREAD fits between the two limits (−300, −76,
148) plus one against the south headland (≈ 265); OUR_PACK = 0.4 of the crowd on your peak, the rest
spread evenly. 40 reseats / 400 surfers: none > 60 m north of you; 175 in your pack, 66 at −240…0, 75 at
0…200, 84 at 200…300; closest to you 7.2 m.

## Wave speed from the real dispersion relation (same day)
Rob felt waves moved "slightly too fast". They did: speed was min(√(g d), c0), right only in very shallow
and deep water; in between (where waves approach the lineup) it ran up to 16% fast vs the exact linear
dispersion ω² = g k tanh(k d). Now `phaseSpeed(c0, T, d)` = Fenton & McKee (1990): c = c0 ·
tanh((k0 d)^¾)^⅔, k0 d = 4π² d / (g T²), within 1.6% of exact over T 5–18 s, d 0.25–40 m (checked with a
bisection solver; note a naive fixed-point solver for tanh dispersion oscillates in shallow water). Used for
crest motion (update), wavelength/shape (surfaceAt) and the GLSL twin. T = 6.5 s at 8 m: 8.86 → 7.78 m/s
(exact 7.73). The train stays unjammed (default 9 waves, natural spacing).
Also: `curlysim-dev` localStorage overrides now apply only with `?debug`, so a plain visit always runs on
the live Open-Meteo conditions (verified: live page matched Open-Meteo current values exactly).
