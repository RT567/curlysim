// Wave physics v2 — discrete wave trains.
//
// Instead of a sum of sinusoids, each incoming wave is an individual object:
// it spawns offshore with a deep-water height dealt by a wave-group generator
// (Rayleigh heights, Kimura-correlated neighbours: real sets and lulls),
// marches shoreward at the linear phase speed (Fenton-McKee dispersion), and
// its SHAPE at any surface point is computed from the local depth there:
//
//   - energy-flux shoaling Ks = sqrt(cg0/cg): height grows as the water shallows
//   - wavelength shortens (L = c T), front face narrows and steepens
//   - as H nears its Goda breaking height the crest feathers and leans (stand
//     up -> pitch), each wave with its own breaking coefficient
//   - past it the wave becomes a depth-limited foamy bore (H ~ 0.45 d) that
//     shrinks as it rolls in, leaving a foam trail
//
// The seabed is a smooth Dean profile, identical all along the beach, so the
// break line is even; the swell angle at the break comes from Snell's law.
//
// The same math lives twice: GLSL (vertex shader) and JS (camera/surfers).
// Keep the twins numerically identical.

import { fromDirToVec, BANK_PEAK_Z, seaDepth, shorelineX, SEABED_GLSL } from './geo.js'

export const MAX_TRAIN = 24
const G = 9.81

// Linear phase speed at depth d for period T (deep-water speed c0 = gT/2pi): Fenton & McKee (1990),
// L = L0 tanh((k0 d)^(3/4))^(2/3), within ~2% of the exact dispersion relation at every depth. The old
// min(sqrt(g d), c0) was right only at the two extremes and ran up to ~15% fast in between, exactly where
// the waves approach the lineup. Twin in WAVE_GLSL (phaseSpeed).
function phaseSpeed(c0, T, d) {
  const k0d = (d * 4 * Math.PI * Math.PI) / (G * T * T)
  return c0 * Math.pow(Math.tanh(Math.pow(k0d, 0.75)), 2 / 3)
}

// Shoaling coefficient H/H0 from conservation of energy flux (linear theory): Ks = sqrt(cg0 / cg), cg = c n,
// n = (1 + 2kd / sinh 2kd) / 2, deep-water cg0 = c0 / 2. Dips slightly below 1 at intermediate depth, then
// grows; capped at 2.2 (the old cap) in the last few decimetres. Replaces Green's law normalised at 12 m,
// which was right for ~14 s groundswell but grew 6-7 s windswell 30-40% too much, breaking it ~30% too
// deep. d floors at 0.4 m, as before. Twin in WAVE_GLSL (shoalK).
function shoalK(T, d) {
  d = Math.max(d, 0.4)
  const c0 = (G * T) / (2 * Math.PI)
  const c = phaseSpeed(c0, T, d)
  const x = (4 * Math.PI * d) / (c * T) // 2kd, with k = 2pi / (c T)
  const n = x > 20 ? 0.5 : 0.5 * (1 + x / Math.sinh(x))
  return Math.min(Math.sqrt(c0 / (2 * c * n)), 2.2)
}

// Breaking height of an individual wave at depth d on bed slope m (Goda 2010, the best of 24 formulas
// against 574 lab cases in Rattanapitikon & Shibayama 2000):  Hb = A L0 (1 - exp(-1.5 pi d/L0 (1 + 11 m^(4/3)))).
// A is drawn per wave around GODA_A (Kriebel 2000 / Li et al. 2000: individual waves in a random train,
// A = 0.14-0.15 +- 0.02), so each wave breaks in its own spot. Steepness steep = H / Hb: feathering
// (STEEP_LEAN) starts at 0.8 (= Goda's A 0.12 / 0.15), full white water by 1.25 (~A 0.19). Twin: godaHb.
const GODA_A = 0.15
const GODA_A_SD = 0.018
function godaHb(L0, d, m, A) {
  return A * L0 * (1 - Math.exp((-1.5 * Math.PI * d * (1 + 11 * Math.pow(m, 4 / 3))) / L0))
}

// standard normal (Box-Muller)
function randn() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
}
// Seabed: geo.js seaDepth — the same ground function the terrain mesh is
// built from (smooth, monotonic, identical cross-shore profile everywhere,
// measured from the local still-water shoreline).
// Refraction: the seabed's contours are straight and parallel to the beach (one cross-shore profile
// everywhere), for which Snell's law is exact for linear waves: sin(theta) / c = const along a ray. The
// train is one set of plane crests, so rebuild() sets their angle to the one the swell has turned to at
// about breaking depth (REFRACT_DEPTH_F x Hs), where you watch them, and scales heights by the refraction
// coefficient Kr = sqrt(cos theta0 / cos theta) there. (Replaces a fixed 25% scaling of the offshore angle.)
const REFRACT_DEPTH_F = 1.4 // ~ breaking depth / Hs for these beaches (shoaling + 0.78 breaker index)
const SPAWN_X = 680 // waves are born this far out
const DIE_X = -14 // world x where a wave is removed, after running up the beach as swash
const SHORE_X = shorelineX(BANK_PEAK_Z) // the train travels along the bank's z line

// Lineup placement (see nonlinearOnsetX): sit this far outside the zone where
// waves stop being clean linear swell. Set waves are dealt at 1.05/1.3/1.1 x Hs
// (+-10%), so 1.3 Hs is the typical biggest wave of a set. The rare max
// (~1.43 Hs) is deliberately NOT the design wave: it may stand up or break
// right at you, as the odd clean-up set does in a real lineup.
export const LINEUP_MARGIN = 8 // m seaward of the onset
const LINEUP_SET_F = 1.3
const STEEP_LEAN = 0.8 // surfaceAt: crest lean starts (smoothstep(0.8, 1.0, steep))

export class WaveField {
  constructor() {
    this.hs = 1
    this.tp = 10
    this.meanDir = { x: -1, z: 0 } // travel direction (toward shore)
    this.waves = [] // { s, H0, L0, c0 }
    this.grp = { re: 0, im: 0, kappa: 0.7 } // wave-group state, see _makeWave
    this.xBreak = 60
    this.faceHeight = 1
    this.uT = new Float32Array(MAX_TRAIN * 4) // s, H0, L0, c0
    this.uA = new Float32Array(MAX_TRAIN) // per-wave Goda A
  }

  rebuild(conditions) {
    const swells = conditions.swells.filter((s) => s.height > 0.02 && s.period > 1)
    let primary = swells[0]
    if (primary && swells[1]) {
      primary = {
        height: Math.hypot(primary.height, swells[1].height * 0.7),
        period: primary.period,
        dir: primary.dir,
      }
    }
    // significant height: decomposed-swell merge, but never below the model's
    // total sea state (the model splits conservatively vs the real buoy)
    this.hs = Math.max(primary ? primary.height : 0.3, (conditions.totalWave ?? 0) * 0.95)
    this.tp = primary ? Math.min(Math.max(primary.period, 4), 18) : 8
    const { dir, kr } = refract(fromDirToVec(primary ? primary.dir : 135), this.tp, Math.min(Math.max(REFRACT_DEPTH_F * this.hs, 1), 8))
    this.meanDir = dir
    this.refractK = kr
    this.hs *= kr // the swell that actually reaches the break: spread along a longer crest when oblique
    // signed offshore wind component (m/s, + = offshore): shifts the breaker
    // index and plunge intensity (Douglass 1990)
    const windVec = fromDirToVec(conditions.windDirFrom ?? 290)
    this.windU = (conditions.windKn ?? 0) * 0.514444 * windVec.x
    this._computeBreak()

    // prefill the domain so the lineup isn't empty on load
    this.waves = []
    // wave-group memory: successive heights correlate strongly in long-travelled groundswell (long, distinct
    // sets) and weakly in local wind sea. kappa per Kimura's 2-D Rayleigh model: ~0.57 at 7 s (rho_HH 0.3),
    // ~0.70 mixed (0.45), 0.80-0.85 for groundswell (0.6-0.7); field rho_HH 0.2-0.65 (CEM II-1, Rodriguez).
    this.grp = { re: randn(), im: randn(), kappa: Math.min(Math.max(0.57 + (this.tp - 7) * 0.05, 0.57), 0.85) }
    const L0 = 1.56 * this.tp * this.tp
    for (let x = 30; x < SPAWN_X; x += L0 * (0.9 + Math.random() * 0.2)) {
      this.waves.push(this._makeWave(x))
    }
    this._pack()
  }

  _makeWave(xStart) {
    // Heights from a complex AR(1) envelope: z <- kappa z + sqrt(1 - kappa^2) (N + iN), H = c |z|. That gives
    // Rayleigh-distributed heights with Kimura's correlation between neighbours, so sets and lulls emerge
    // on their own: runs of 1.5-2.3 waves above Hs, sets every ~10-17 waves, the biggest of ~100 about
    // 1.5 Hs. Scale: mean H^2 = 8 m0 = Hs^2 / 2 for a Rayleigh sea; with the usual 0.95 correction for real
    // seas, (0.95 Hs)^2 / 2 = 2 c^2 (E|z|^2 = 2), so c = 0.475 Hs.
    const g = this.grp
    const q = Math.sqrt(1 - g.kappa * g.kappa)
    g.re = g.kappa * g.re + q * randn()
    g.im = g.kappa * g.im + q * randn()
    const f = Math.min(0.475 * Math.hypot(g.re, g.im), 2.2) // H / Hs
    // periods scatter round the mean, less for groundswell and for the big waves (Longuet-Higgins)
    const sigT = (this.tp < 9 ? 0.22 : this.tp > 12 ? 0.12 : 0.22 - ((this.tp - 9) / 3) * 0.1) * Math.max(0.4, 1.3 - 0.6 * f)
    const T = Math.min(Math.max(this.tp * (1 + sigT * randn()), 0.6 * this.tp, 4), 1.6 * this.tp, 20)
    return {
      s: this._sAt(xStart),
      H0: Math.max((this.hs * f) / 1.2, 0.05), // crest height above still water; full height = 1.2 H0
      L0: 1.56 * T * T,
      c0: 1.56 * T,
      A: Math.min(Math.max(GODA_A + GODA_A_SD * randn(), 0.11), 0.19), // this wave's breaking strength
      E: 1, // energy factor: decays while breaking, so reformed waves are smaller
    }
  }

  _sAt(x) {
    return x * this.meanDir.x + BANK_PEAK_Z * this.meanDir.z
  }

  _xAt(s) {
    return (s - BANK_PEAK_Z * this.meanDir.z) / this.meanDir.x
  }

  // advance the train — call once per frame
  update(dt) {
    dt = Math.min(dt, 0.1)
    let furthestOut = -1
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]
      const x = this._xAt(w.s)
      const d = this.depthAt(x, BANK_PEAK_Z)
      const c = phaseSpeed(w.c0, w.L0 / w.c0, d)
      w.s += c * dt
      // queue behind the wave ahead so crests never overtake and merge. The gap
      // is a fraction of the LOCAL wavelength c*T: crests bunch up naturally in
      // shallow water, and a deep-water gap (0.3 L0) held every wave behind the
      // near-shore ones, jamming the whole train at minimum spacing out to sea
      // (2-3x the live waves, up to MAX_TRAIN, every one costing per vertex).
      // A wave already up the sand is invisible swash and holds nobody back.
      const ahead = this.waves[i - 1]
      if (ahead && this._xAt(ahead.s) > SHORE_X) w.s = Math.min(w.s, ahead.s - 0.3 * c * (w.L0 / w.c0))
      // breaking dissipates energy (20-60% per plunge): while this wave is
      // over its depth limit, bleed height so it reforms SMALLER in the trough
      const ks = shoalK(w.L0 / w.c0, d)
      const m = this._slopeAt(x, BANK_PEAK_Z)
      if (1.2 * w.H0 * w.E * ks > godaHb(w.L0, d, m, w.A)) {
        w.E = Math.max(w.E * (1 - 0.45 * dt), 0.3)
      }
      // removed at a fixed world x: the crests span the whole beach, and mid-beach the shoreline is only
      // 3-17 m out, so dying relative to the bank's shoreline popped visible waves there. Crawling up the
      // sand at the bank no longer jams anything (it holds nobody back, above).
      if (this._xAt(w.s) < DIE_X) this.waves.splice(i, 1)
      else furthestOut = Math.max(furthestOut, x)
    }
    // spawn the next wave one wavelength behind the last one
    if (this.waves.length < MAX_TRAIN) {
      const L0 = 1.56 * this.tp * this.tp
      if (furthestOut < SPAWN_X - L0 * (0.9 + 0.2 * Math.random())) {
        this.waves.push(this._makeWave(SPAWN_X))
      }
    }
    this._pack()
  }

  _computeBreak() {
    // break line over the bank for seating/crowds: where a typical biggest-of-set wave (1.3 Hs) first
    // reaches its Goda breaking height (mean A), marching in from offshore
    const L0 = 1.56 * this.tp * this.tp
    this.xBreak = 25
    this.faceHeight = this.hs * 1.3
    for (let x = 500; x >= 25; x -= 5) {
      const dd = this.depthAt(x, BANK_PEAK_Z)
      const h = this.hs * 1.3 * shoalK(this.tp, dd)
      if (h >= godaHb(L0, dd, this._slopeAt(x, BANK_PEAK_Z), GODA_A)) {
        this.xBreak = x
        this.faceHeight = h
        break
      }
    }
  }

  // bed slope felt along travel at (x, z): depth behind minus depth ahead over 16 m, clamped
  _slopeAt(x, z) {
    const md = this.meanDir
    return Math.min(Math.max((this.depthAt(x - md.x * 8, z - md.z * 8) - this.depthAt(x + md.x * 8, z + md.z * 8)) / 16, 0.01), 0.12)
  }

  // --- lineup: where a surfer waits, just outside the nonlinear zone ---
  //
  // Same per-point criterion surfaceAt uses: steep = H_full / Hb with the
  // wind-shifted Goda breaking height; at steep 0.8 the crest starts to lean (lip
  // rotation smoothstep) and the swell stops being a clean linear wave. March
  // in from offshore along this z line and return the outermost x where a
  // typical biggest-of-set wave (LINEUP_SET_F x Hs) reaches that onset.
  // Pure query: doesn't touch the wave train.
  nonlinearOnsetX(z = BANK_PEAK_Z) {
    const md = this.meanDir
    const windT = Math.tanh(this.windU / 8)
    const T = this.tp
    const shore = shorelineX(z)
    for (let x = SPAWN_X - 40; x >= shore; x -= 1) {
      const d = this.depthAt(x, z)
      const slope = Math.min(
        Math.max((this.depthAt(x - md.x * 8, z - md.z * 8) - this.depthAt(x + md.x * 8, z + md.z * 8)) / 16, 0.01),
        0.12
      )
      const hFull = this.hs * LINEUP_SET_F * shoalK(T, d)
      if (hFull / (godaHb(1.56 * T * T, d, slope, GODA_A) * (1 + 0.15 * windT)) >= STEEP_LEAN) return x
    }
    return shore // nothing goes nonlinear before the sand (tiny swell)
  }

  // where to sit on this z line: LINEUP_MARGIN metres outside the onset.
  // (camera.js lineupX adds the hard shore / depth clamps)
  lineupX(z = BANK_PEAK_Z) {
    return this.nonlinearOnsetX(z) + LINEUP_MARGIN
  }

  _pack() {
    this.uT.fill(0)
    this.uA.fill(GODA_A)
    const n = Math.min(this.waves.length, MAX_TRAIN)
    for (let i = 0; i < n; i++) {
      const w = this.waves[i]
      this.uT[i * 4] = w.s
      this.uT[i * 4 + 1] = w.H0 * w.E // shader sees the dissipated height
      this.uT[i * 4 + 2] = w.L0
      this.uT[i * 4 + 3] = w.c0
      this.uA[i] = w.A
    }
  }

  // --- CPU twins of the GLSL (keep numerically identical) ---

  // still-water depth from the shared ground function; the 0.25 m floor is
  // numerical only (keeps sqrt(g d) and H/d finite in the swash)
  depthAt(x, z) {
    return Math.max(seaDepth(x, z), 0.25)
  }

  // Water surface height + foam at a fixed world point.
  // Physics per point (calibrated from coastal engineering literature):
  //   Hb = Goda(L0, d, slope, A_wave), wind-shifted   -> where it breaks
  //   xi (Iribarren) = slope / sqrt(H_full/L0)        -> HOW it breaks
  //   P = (xi_eff - 0.4)/0.8                          -> spill..plunge 0..1
  //   lip rotation angle & throw scale with P; bore decays to ~0.4 d and
  //   REFORMS automatically when it runs into deeper water (channel/trough).
  surfaceAt(x, z, out = {}) {
    const d = this.depthAt(x, z)
    // waves persist onto the sand (swash) and fade over the last berm metres
    const xs = x - shorelineX(z) // metres seaward of the local shoreline
    const shore = smoothstep(-18, -2, xs)
    const sPos = x * this.meanDir.x + z * this.meanDir.z
    // bottom slope the wave feels, along travel: depth behind minus depth
    // ahead over 16 m (positive = shoaling)
    const slope = Math.min(
      Math.max(
        (this.depthAt(x - this.meanDir.x * 8, z - this.meanDir.z * 8) -
          this.depthAt(x + this.meanDir.x * 8, z + this.meanDir.z * 8)) /
          16,
        0.01
      ),
      0.12
    )
    const windT = Math.tanh(this.windU / 8)
    let y = 0
    let foam = 0
    let leanX = 0
    let leanZ = 0
    for (const w of this.waves) {
      const T = w.L0 / w.c0
      const c = phaseSpeed(w.c0, T, d)
      // rendered wavelength floors at 25% of deep-water L so faces stay wide
      // enough for both realism and the mesh to resolve
      const L = Math.max(c * T, 0.25 * w.L0, 6)
      // cheap distance check FIRST — most waves are nowhere near this point
      const xi = (sPos - w.s) / L
      if (xi > 1.6 || xi < -1.6) continue
      let H = w.H0 * w.E * shoalK(T, d)
      const hFull = 1.2 * H
      // Goda breaking height for this wave, wind-shifted (offshore holds the wave up; Douglass 1990)
      const steep = hFull / (godaHb(w.L0, d, slope, w.A) * (1 + 0.15 * windT))
      const brk = smoothstep(0.95, 1.25, steep)
      // Iribarren plunge intensity: spill at xi<=0.4, slab throw at xi>=1.2
      const xiB = (slope / Math.sqrt(hFull / w.L0)) * (1 + 0.25 * windT)
      const P = Math.min(Math.max((xiB - 0.4) / 0.8, 0), 1)
      // soft-knee depth cap: height stays continuous through breaking; the
      // per-wave energy decay is what actually shrinks the bore over time
      // broken waves settle toward the stable bore height ~0.4 d (Dally, Dean & Dalrymple 1985)
      const hCap = 0.45 * d
      if (H > hCap) H = hCap + (H - hCap) * 0.25
      // broken bore is a compact roll, not a wavelength-wide tent
      const wScale = 1 - 0.6 * brk
      const wf = 0.12 * (1.0 - 0.35 * Math.min(steep, 1)) * wScale
      const wb = 0.2 * wScale
      const u = xi > 0 ? xi / wf : xi / wb
      const kern = Math.exp(-u * u)
      const yw = H * kern
      // curl = rotation of the crest tip around a pivot at 0.62 H; angle and
      // throw scale with plunge intensity P (horizontal part is GPU-only)
      const frontGate = smoothstep(-0.3, 0.1, xi)
      const lip = yw - 0.62 * H
      if (lip > 0) {
        const theta =
          (0.55 * smoothstep(0.8, 1.0, steep) * (0.3 + 0.7 * P) + (0.7 + 0.9 * P) * brk) * frontGate
        // progressive rotation: angle grows up the lip, so the face bends
        // into a concave arc instead of shearing into a flat plane
        const ang = theta * Math.min(lip / (0.38 * H), 1)
        y += yw - lip * (1 - Math.cos(ang))
        leanX += this.meanDir.x * lip * Math.sin(ang)
        leanZ += this.meanDir.z * lip * Math.sin(ang)
      } else {
        y += yw
      }
      // foam: feathering on the crest from the onset of steepening (light), then white water on the broken
      // crest trailing over the water it already crossed
      const trail = xi < 0 ? Math.exp(-Math.pow(xi / 0.55, 2)) : 0
      foam += 0.3 * smoothstep(STEEP_LEAN, 1.0, steep) * kern * frontGate + brk * Math.max(kern, 0.75 * trail)
    }
    // waterline: a thin sheet tucked just under the beach ramp (capped at
    // ankle height so it can never surface through low terrain inland);
    // swash pulses lift it above the sand so the water's edge runs up/recedes
    const swashBed = Math.min(Math.max(-xs, 0) * 0.035, 0.22) - 0.06
    out.y = Math.max(y * shore, swashBed)
    out.foam = Math.min(foam, 1) * shore
    out.leanX = leanX
    out.leanZ = leanZ
    return out
  }

  // per-frame callers (camera, body, crowd): no allocation
  heightAt(x, z, _t) {
    return this.surfaceAt(x, z, _scratch).y
  }

  // --- diagnostics (dev console + agent probing; not used by rendering) ---

  // per-wave physics snapshot at its current position on the given z line
  waveStates(z = BANK_PEAK_Z) {
    return this.waves.map((w) => {
      const x = this._xAt(w.s)
      const d = this.depthAt(x, z)
      const slope = Math.min(
        Math.max(
          (this.depthAt(x - this.meanDir.x * 8, z - this.meanDir.z * 8) -
            this.depthAt(x + this.meanDir.x * 8, z + this.meanDir.z * 8)) /
            16,
          0.01
        ),
        0.12
      )
      const T = w.L0 / w.c0
      const H = w.H0 * shoalK(T, d)
      const hFull = 1.2 * H
      const windT = Math.tanh(this.windU / 8)
      const hb = godaHb(w.L0, d, slope, w.A) * (1 + 0.15 * windT)
      const steep = hFull / hb
      const xiB = (slope / Math.sqrt(hFull / w.L0)) * (1 + 0.25 * windT)
      const P = Math.min(Math.max((xiB - 0.4) / 0.8, 0), 1)
      const state = steep > 1.3 ? 'BORE' : steep > 0.95 ? 'BREAKING' : steep > 0.7 ? 'STANDING' : 'flat'
      return {
        x: +x.toFixed(0),
        d: +d.toFixed(1),
        slope: +slope.toFixed(3),
        H0: +w.H0.toFixed(2),
        H: +H.toFixed(2),
        Hb: +hb.toFixed(2),
        A: +w.A.toFixed(3),
        steep: +steep.toFixed(2),
        xi: +xiB.toFixed(2),
        plunge: +P.toFixed(2),
        state,
      }
    })
  }

  // cross-shore surface profile: y (and depth) sampled on a z line
  profile(z = BANK_PEAK_Z, x0 = 10, x1 = 500, step = 5) {
    const rows = []
    for (let x = x0; x <= x1; x += step) {
      rows.push({ x, y: +this.surfaceAt(x, z).y.toFixed(2), d: +this.depthAt(x, z).toFixed(1) })
    }
    return rows
  }

  normalAt(x, z, t, eps = 2.0, out = {}) {
    const hx1 = this.heightAt(x + eps, z, t)
    const hx0 = this.heightAt(x - eps, z, t)
    const hz1 = this.heightAt(x, z + eps, t)
    const hz0 = this.heightAt(x, z - eps, t)
    const nx = (hx0 - hx1) / (2 * eps)
    const nz = (hz0 - hz1) / (2 * eps)
    const l = Math.hypot(nx, 1, nz)
    out.x = nx / l
    out.y = 1 / l
    out.z = nz / l
    return out
  }
}

const _scratch = { y: 0, foam: 0, leanX: 0, leanZ: 0 }

// Snell's law over straight, beach-parallel contours: the deep-water travel direction v (toward shore)
// turns toward the shore normal (-X) as the wave slows; returns the direction at depth d and Kr there.
function refract(v, T, d) {
  const a0 = Math.max(Math.min(Math.atan2(-v.z, -v.x), 1.48), -1.48) // signed angle off the normal, < 85 deg
  const c0 = (G * T) / (2 * Math.PI)
  const a = Math.asin(Math.sin(a0) * (phaseSpeed(c0, T, d) / c0))
  return { dir: { x: -Math.cos(a), z: -Math.sin(a) }, kr: Math.sqrt(Math.cos(a0) / Math.cos(a)) }
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

// --- GLSL twin ---
export const WAVE_GLSL = /* glsl */ `
  uniform vec4 uTrain[${MAX_TRAIN}]; // s, H0, L0, c0
  uniform float uGodaA[${MAX_TRAIN}]; // per-wave Goda breaking coefficient
  uniform vec2 uSwellDir; // travel direction (toward shore)
  uniform float uWindU; // offshore wind component, m/s (+ = offshore)

  ${SEABED_GLSL}
  float depthAt(vec2 p) {
    return max(seaDepth(p), 0.25);
  }

  // twin of waves.js phaseSpeed (Fenton & McKee dispersion)
  float phaseSpeed(float c0, float T, float d) {
    float k0d = d * ${(4 * Math.PI * Math.PI).toFixed(6)} / (${G} * T * T);
    return c0 * pow(tanh(pow(k0d, 0.75)), 2.0 / 3.0);
  }

  // twin of waves.js shoalK (energy-flux shoaling)
  float shoalK(float T, float d) {
    d = max(d, 0.4);
    float c0 = ${G} * T / ${(2 * Math.PI).toFixed(6)};
    float c = phaseSpeed(c0, T, d);
    float x = ${(4 * Math.PI).toFixed(6)} * d / (c * T);
    float n = x > 20.0 ? 0.5 : 0.5 * (1.0 + x / sinh(x));
    return min(sqrt(c0 / (2.0 * c * n)), 2.2);
  }

  // xyz = displacement (xz: crest lean), w = foam
  // Twin of waves.js surfaceAt — keep numerically identical.
  float gPhase; // debug: max steep of any wave present at this point
  vec4 surf(vec2 p) {
    gPhase = 0.0;
    float d = depthAt(p);
    float xs = p.x - shorelineX(p.y); // metres seaward of the local shoreline
    float shore = smoothstep(-18.0, -2.0, xs);
    float sPos = dot(p, uSwellDir);
    // bottom slope along travel: depth behind minus ahead (+ = shoaling)
    float slope = clamp(
      (depthAt(p - uSwellDir * 8.0) - depthAt(p + uSwellDir * 8.0)) / 16.0,
      0.01, 0.12);
    float slopeG = 1.0 + 11.0 * pow(slope, 1.3333333); // Goda bed-slope term
    float windT = tanh(uWindU / 8.0);
    float y = 0.0;
    float foam = 0.0;
    vec2 lean = vec2(0.0);
    for (int i = 0; i < ${MAX_TRAIN}; i++) {
      vec4 W = uTrain[i];
      if (W.y < 1e-4) continue;
      float T = W.z / W.w;
      float c = phaseSpeed(W.w, T, d);
      float L = max(max(c * T, 0.25 * W.z), 6.0);
      // cheap distance check FIRST — skip waves nowhere near this vertex
      float xi = (sPos - W.x) / L;
      if (abs(xi) > 1.6) continue;
      float H = W.y * shoalK(T, d);
      float hFull = 1.2 * H;
      // twin of godaHb (Goda 2010), wind-shifted
      float hb = uGodaA[i] * W.z * (1.0 - exp(-4.712389 * d * slopeG / W.z)) * (1.0 + 0.15 * windT);
      float steep = hFull / hb;
      float brk = smoothstep(0.95, 1.25, steep);
      float xiB = (slope / sqrt(hFull / W.z)) * (1.0 + 0.25 * windT);
      float P = clamp((xiB - 0.4) / 0.8, 0.0, 1.0);
      float hCap = 0.45 * d;
      if (H > hCap) H = hCap + (H - hCap) * 0.25;
      float wScale = 1.0 - 0.6 * brk;
      float wf = 0.12 * (1.0 - 0.35 * min(steep, 1.0)) * wScale;
      float wb = 0.2 * wScale;
      float u = xi > 0.0 ? xi / wf : xi / wb;
      float kern = exp(-u * u);
      float yw = H * kern;
      if (kern > 0.25) gPhase = max(gPhase, steep);
      float frontGate = smoothstep(-0.3, 0.1, xi);
      float lip = yw - 0.62 * H;
      if (lip > 0.0) {
        float theta = (0.55 * smoothstep(0.8, 1.0, steep) * (0.3 + 0.7 * P)
                     + (0.7 + 0.9 * P) * brk) * frontGate;
        // progressive rotation: angle grows up the lip -> concave arc face,
        // tip curls hardest; never a flat shear plane
        float ang = theta * min(lip / (0.38 * H), 1.0);
        y += yw - lip * (1.0 - cos(ang));
        lean += uSwellDir * lip * sin(ang);
      } else {
        y += yw;
      }
      float trail = xi < 0.0 ? exp(-pow(xi / 0.55, 2.0)) : 0.0;
      foam += 0.3 * smoothstep(${STEEP_LEAN.toFixed(2)}, 1.0, steep) * kern * frontGate + brk * max(kern, 0.75 * trail);
    }
    float swashBed = min(max(-xs, 0.0) * 0.035, 0.22) - 0.06;
    return vec4(lean.x, max(y * shore, swashBed), lean.y, min(foam, 1.0) * shore);
  }
`
