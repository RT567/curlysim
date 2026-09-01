# curlysim

POV simulation of sitting out the back at North Curl Curl beach (Sydney) in the
**current, real conditions** — swell, wind, weather, sun, and crowd.

Live at: https://rt567.github.io/curlysim/

- Drag to look around. That's the whole UI — no HUD. It's a sim: if it's a lull,
  you wait for the set, like everyone else out there.
- Swell height/period/direction and wind from [Open-Meteo](https://open-meteo.com)
  (marine + forecast APIs), refreshed every 15 min. Sun and moon computed with
  suncalc. Crowd size derived from conditions + time of day/week.
- Three.js + Vite. Waves are summed Gerstner components driven by the real
  numbers (wavelength = gT²/2π etc.), with detuned siblings for genuine
  sets-and-lulls beat timing and a Stokes-style crest jacking near the break.

Dev: `npm install && npm run dev`. Add `?debug` to the URL for a lil-gui panel
with condition overrides and a clock scrubber.
