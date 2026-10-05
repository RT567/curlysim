# Physics from the literature + the measured Curl Curl seabed — 2026-10-05

Rob asked for the wave physics to be "really good within its limitations": researched, not tuned by eye.
Two research passes (sources below) and one data pull drove these changes; every number was re-measured
headless (waves.js + geo.js under node) after implementing.

## Wave physics (src/waves.js; every formula has a GLSL twin in WAVE_GLSL)
- **Speed**: Fenton & McKee (1990) dispersion, `phaseSpeed`, within 1.6% of exact (old min(sqrt(gd), c0)
  ran up to 16% fast at 5-12 m). ALL crests travel at the peak-period speed (a sea moves together); each
  wave's own period sets its wavelength/shape and the gap behind the crest ahead, at the LOCAL speed (the
  spawn line is ~10-15 m deep; a deep-water gap spaced long-period crests up to 2.5x the period apart).
  Moving each crest at its own period's speed bunched 3-4 crests nose to tail; don't reintroduce that.
- **Shoaling**: energy flux, Ks = sqrt(cg0/cg), `shoalK` (old Green's law normalised at 12 m was right for
  ~14 s swell but grew 6-7 s windswell 30-40% too much, so it broke ~30% too deep).
- **Breaking**: Goda (2010), Hb = A L0 (1 - exp(-1.5 pi d/L0 (1 + 11 m^(4/3)))), best of 24 formulas
  (Rattanapitikon & Shibayama 2000); A drawn per wave ~ N(0.15, 0.018) clamped 0.11-0.19 (Kriebel 2000,
  Li et al. 2000, Black & Rosenberg 1992 Apollo Bay), sent to the shader as `uGodaA[]`. steep = H/Hb:
  feathering from 0.8 (= A 0.12/0.15), white water by 1.25. Broken waves settle toward ~0.45 d (DDD 1985).
- **Refraction**: Snell over beach-parallel contours at ~breaking depth (1.4 Hs), with Kr on height
  (replaces SWELL_ANGLE_FACTOR 0.25; gives almost the same angles, e.g. 37 deg offshore -> 11.5 deg).
- **Sets**: complex AR(1) envelope, H = 0.475 Hs |z|, kappa 0.57 (7 s) -> 0.85 (13 s+). Measured over
  1e5 waves: rho_HH 0.31/0.49/0.70, mean run above H1/3 1.47/1.74/2.31, a set every 10.8/12.9/17.1 waves,
  Hmax per 100 = 1.50/1.47/1.42 Hs for 6.5/10/14 s — all on the literature targets. (The research report's
  scale "(0.95 Hm0)^2/8" was wrong by 2x: mean H^2 = 8 m0 = Hs^2/2.) Period scatter CoV 0.22 windsea ->
  0.12 groundswell, smaller for big waves; crest-to-crest at 150 m: 6.6 s mean (4-10) for T 6.5.
- **Foam** back on, light: 0.3 x feathering from steep 0.8 + white water on broken crests; the fragment
  shows 0.6 x smoothstep(vFoam).
- **Seat cap**: the lineup search uses min(Hs, 2 m) (six foot by surfers' back measure); above that Curly
  closes out and the seat stops moving out.

## Seabed (src/geo.js) — MEASURED
NSW Marine LiDAR Topo-Bathy 2018 (NSW OEH / Fugro; 5 m grid; AHD ~ MSL; ±0.3-0.5 m), queried point by
point via the public ArcGIS MapServer identify on layer 2 (the server drops ~half the requests: retry),
three shore-normal transects (north at ~225 m from the headland corner, mid, south), averaged into
BED_X/BED_D, piecewise linear, 1:55 tail; beach face 1:13. Raw profiles: curlcurl-bathymetry-2018-profiles.json.
Cross-checked with the ShoreShop2.0 "Beach X" grid (Curl Curl). Real bed: ~1:48 to 3 m depth (at ~145 m;
a 2.5-3.5 m terrace 80-190 m out), ~1:50 beyond, 10 m contour ~495 m; shallower than a Dean A=0.13
profile inside 200 m, deeper beyond 300 m. The 2018 north transect has a weak trough (4.4 m @ 200 m) and
bar (3.8 m @ 240 m); bars/rips are deliberately left out for now (smooth, identical along the beach).

Result (10 s swell): biggest sets break at 36 / 96 / 231 m from the waterline for Hs 0.5 / 1 / 2 m; you sit
at 58 / 142 / 276 m (capped above 2 m). Short-period breaks a little closer in, long-period further out.

## Open
- Seat criterion: currently outside where set waves start to feather (+8 m); sitting just outside where they
  BREAK (+~10 m) would be ~35-40 m closer on 1-2 m days. Rob to decide.
- Tide (Open-Meteo sea_level_height_msl fetched, unused), second swell, sandbars/rips, crest bending via
  per-crest x-tables (research suggests a small texture), a trough in the rendered wave profile (faces are
  ~17% shorter than the physics height).
