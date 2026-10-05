# ai-notes — the story of curlysim

Chronological documents for AI agents (and humans) arriving in this directory: what this is, how the
idea evolved and why, how it's built and deployed, and what to watch out for. Written by Claude working
with Rob. Convention: `NN-topic-YYYY-MM-DD.md`, numbered in order; add a new dated doc when you make a
significant change or decision, and keep the newest doc's "current state" accurate.

1. [01-overview-and-timeline-2026-09-02.md](01-overview-and-timeline-2026-09-02.md) — the sim, its physics commits day by day, and the Actions-based Pages deploy
2. [02-body-scale-lineup-seabed-2026-10-05.md](02-body-scale-lineup-seabed-2026-10-05.md) — your legs + a true-size 6'6" board, crowd rules (1–20 surfers, 4.6 m gap, lineup band, north wall), softened swell angle, one shared seabed/beach elevation function, lineup seat just outside the nonlinear onset
3. [03-wave-train-jam-slowdown-2026-10-05.md](03-wave-train-jam-slowdown-2026-10-05.md) — the sudden permanent slowdown: the wave queue jammed (deep-water gap + waves dying far up the sand), live waves 2–3× normal; fixed by queueing on the local wavelength and dying relative to the shoreline
4. [04-render-cost-mobile-quality-2026-10-05.md](04-render-cost-mobile-quality-2026-10-05.md) — measured: no leaks, the jam was the only growth; tiled/culled ocean, phone pixel-ratio + grid defaults, adaptive pixel ratio, merged crowd meshes, allocation-free sampling; open question on e13bda5's shoreline-relative wave removal (visible pop mid-beach)
5. [05-physics-from-literature-and-real-seabed-2026-10-05.md](05-physics-from-literature-and-real-seabed-2026-10-05.md) — dispersion, energy-flux shoaling, Goda breaking, Snell refraction, AR(1) wave groups, light foam; seabed from the NSW Marine LiDAR 2018 survey; seat capped at 2 m
