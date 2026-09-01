// Wave physics v2 — discrete wave trains.
//
// Instead of a sum of sinusoids, each incoming wave is an individual object:
// it spawns offshore with a deep-water height dealt by a set/lull group
// generator, marches shoreward at the real depth-dependent speed
// c = min(sqrt(g d), c0), and its SHAPE at any surface point is computed from
// the local depth there:
//
//   - Green's-law shoaling: height grows as the water shallows
//   - wavelength shortens (L = c T), front face narrows and steepens
//   - near H = 0.78 d the crest leans shoreward (stand up -> pitch)
//   - past the limit it becomes a depth-limited foamy bore (H ~ 0.55 d)
//     that shrinks as it rolls in, leaving a foam trail
//
// The sandbank is part of the DEPTH FIELD (shallower on the A-frame peak), so
// waves jack and break there first and peel toward the channels — real
// bathymetry behavior, not scripted.
//
// The same math lives twice: GLSL (vertex shader) and JS (camera/surfers).
// Keep the twins numerically identical.

import { fromDirToVec, BANK_PEAK_Z, BANK_K, BREAKER_INDEX } from './geo.js'

export const MAX_TRAIN = 24
const G = 9.81
const D_REF = 12 // depth (m) beyond which shoaling is negligible
// concave beach profile d = A*x^2/(x+X0): gentle at the waterline, steepening
// through the surf zone (real beach shape; puts breaks 60-250 m out)
const DEPTH_A = 0.055
const DEPTH_X0 = 120
// the sandbar: a mound on the bed with a STEEP seaward face (locally ~1:9) —
// per the breaker literature this face is what makes waves throw instead of
// spill; the deeper trough behind it lets broken waves reform
const BAR_H = 2.8
const BAR_X = 165
const BAR_W = 30
const SPAWN_X = 680 // waves are born this far out
const DIE_X = 4

export class WaveField {
  constructor() {
    this.hs = 1
    this.tp = 10
    this.meanDir = { x: -1, z: 0 } // travel direction (toward shore)
    this.waves = [] // { s, H0, L0, c0 }
    this.groupN = 0
    this.xBreak = 60
    this.faceHeight = 1
    this.uT = new Float32Array(MAX_TRAIN * 4) // s, H0, L0, c0
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
    this.hs = primary ? primary.height : 0.3
    this.tp = primary ? Math.min(Math.max(primary.period, 4), 18) : 8
    this.meanDir = fromDirToVec(primary ? primary.dir : 135)
    // signed offshore wind component (m/s, + = offshore): shifts the breaker
    // index and plunge intensity (Douglass 1990)
    const windVec = fromDirToVec(conditions.windDirFrom ?? 290)
    this.windU = (conditions.windKn ?? 0) * 0.514444 * windVec.x
    this._computeBreak()

    // prefill the domain so the lineup isn't empty on load
    this.waves = []
    this.groupN = Math.floor(Math.random() * 11)
    const L0 = 1.56 * this.tp * this.tp
    for (let x = 30; x < SPAWN_X; x += L0 * (0.9 + Math.random() * 0.2)) {
      this.waves.push(this._makeWave(x))
    }
    this._pack()
  }

  _makeWave(xStart) {
    // set/lull group sequence: ~3 solid waves out of every 11
    const g = this.groupN % 11
    this.groupN++
    // every wave dealt set-sized for now (lull/set variation parked)
    let f
    if (g === 8 || g === 9 || g === 10) {
      f = [1.1, 1.35, 1.15][g - 8] * (0.92 + Math.random() * 0.16)
    } else {
      f = 1.0 + Math.random() * 0.2
    }
    const T = this.tp * (0.95 + Math.random() * 0.1)
    return {
      s: this._sAt(xStart),
      H0: Math.max(this.hs * f * 1.3, 0.05), // crest height above still water
      L0: 1.56 * T * T,
      c0: 1.56 * T,
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
      const c = Math.min(Math.sqrt(G * d), w.c0)
      w.s += c * dt
      // queue behind the wave ahead — crests never overtake and merge
      const ahead = this.waves[i - 1]
      if (ahead) w.s = Math.min(w.s, ahead.s - 0.3 * w.L0)
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
    // break line over the bank for seating/crowds: solve where a typical
    // dealt wave's FULL height (1.2 x crest, crest = hs*1.15*1.3) meets 0.78 d
    const hFull = this.hs * 1.15 * 1.3 * 1.2
    let d = Math.max(hFull / BREAKER_INDEX, 0.5)
    for (let i = 0; i < 3; i++) {
      const green = Math.min(Math.pow(D_REF / Math.max(d, 0.4), 0.25), 2.2)
      d = Math.max((hFull * Math.max(green, 1)) / BREAKER_INDEX, 0.5)
    }
    this.faceHeight = d * BREAKER_INDEX
    // march shoreward over the real bathymetry (bar included): the first spot
    // a typical dealt wave meets the depth limit is the break line
    this.xBreak = 25
    for (let x = 500; x >= 25; x -= 5) {
      const dd = this.depthAt(x, BANK_PEAK_Z)
      const green = Math.min(Math.pow(D_REF / Math.max(dd, 0.4), 0.25), 2.2)
      if (hFull * Math.max(green, 1) >= 0.9 * dd) {
        this.xBreak = x
        break
      }
    }
  }

  _pack() {
    this.uT.fill(0)
    const n = Math.min(this.waves.length, MAX_TRAIN)
    for (let i = 0; i < n; i++) {
      const w = this.waves[i]
      this.uT[i * 4] = w.s
      this.uT[i * 4 + 1] = w.H0
      this.uT[i * 4 + 2] = w.L0
      this.uT[i * 4 + 3] = w.c0
    }
  }

  // --- CPU twins of the GLSL (keep numerically identical) ---

  depthAt(x, z) {
    const base = (DEPTH_A * x * x) / (x + DEPTH_X0)
    const bankZ = Math.max(Math.cos((z - BANK_PEAK_Z) * BANK_K), 0)
    const bar = BAR_H * Math.exp(-Math.pow((x - BAR_X) / BAR_W, 2)) * bankZ
    return Math.max(base - bar, 0.25)
  }

  // Water surface height + foam at a fixed world point.
  // Physics per point (calibrated from coastal engineering literature):
  //   gamma = Weggel(slope, H/gT^2), wind-shifted     -> where it breaks
  //   xi (Iribarren) = slope / sqrt(H_full/L0)        -> HOW it breaks
  //   P = (xi_eff - 0.4)/0.8                          -> spill..plunge 0..1
  //   lip rotation angle & throw scale with P; bore decays to ~0.4 d and
  //   REFORMS automatically when it runs into deeper water (channel/trough).
  surfaceAt(x, z) {
    const d = this.depthAt(x, z)
    const shore = smoothstep(-2, 6, x)
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
    const wA = 43.8 * (1 - Math.exp(-19 * slope))
    const wB = 1.56 / (1 + Math.exp(-19.5 * slope))
    const windT = Math.tanh(this.windU / 8)
    let y = 0
    let foam = 0
    for (const w of this.waves) {
      const c = Math.min(Math.sqrt(G * d), w.c0)
      const T = w.L0 / w.c0
      // rendered wavelength floors at 15% of deep-water L so shallow waves
      // stay wide mounds instead of collapsing into slivers
      const L = Math.max(c * T, 0.15 * w.L0, 6)
      let H = w.H0 * Math.min(Math.pow(D_REF / Math.max(d, 0.4), 0.25), 2.2)
      const hFull = 1.2 * H
      // Weggel breaker index, wind-shifted (offshore holds the wave up)
      const gamma = Math.min(Math.max(wB - (wA * hFull) / (G * T * T), 0.6), 1.5) * (1 + 0.15 * windT)
      const steep = hFull / (gamma * d)
      const brk = smoothstep(0.95, 1.25, steep)
      // Iribarren plunge intensity: spill at xi<=0.4, slab throw at xi>=1.2
      const xiB = (slope / Math.sqrt(hFull / w.L0)) * (1 + 0.25 * windT)
      const P = Math.min(Math.max((xiB - 0.4) / 0.8, 0), 1)
      H = H * (1 - brk) + 0.4 * d * brk
      const xi = (sPos - w.s) / L
      if (xi > 1.6 || xi < -1.6) continue
      const wf = 0.12 * (1.05 - 0.5 * Math.min(steep, 1))
      const wb = 0.2
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
        y += yw - lip * (1 - Math.cos(theta))
      } else {
        y += yw
      }
      // foam: on the broken crest, trailing over the water it already crossed
      const trail = xi < 0 ? Math.exp(-Math.pow(xi / 0.55, 2)) : 0
      foam += brk * Math.max(kern, 0.75 * trail)
    }
    return { y: y * shore, foam: Math.min(foam, 1) * shore }
  }

  heightAt(x, z, _t) {
    return this.surfaceAt(x, z).y
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
      const green = Math.min(Math.pow(D_REF / Math.max(d, 0.4), 0.25), 2.2)
      const H = w.H0 * green
      const hFull = 1.2 * H
      const T = w.L0 / w.c0
      const wA = 43.8 * (1 - Math.exp(-19 * slope))
      const wB = 1.56 / (1 + Math.exp(-19.5 * slope))
      const windT = Math.tanh(this.windU / 8)
      const gamma = Math.min(Math.max(wB - (wA * hFull) / (G * T * T), 0.6), 1.5) * (1 + 0.15 * windT)
      const steep = hFull / (gamma * d)
      const xiB = (slope / Math.sqrt(hFull / w.L0)) * (1 + 0.25 * windT)
      const P = Math.min(Math.max((xiB - 0.4) / 0.8, 0), 1)
      const state = steep > 1.3 ? 'BORE' : steep > 0.95 ? 'BREAKING' : steep > 0.7 ? 'STANDING' : 'flat'
      return {
        x: +x.toFixed(0),
        d: +d.toFixed(1),
        slope: +slope.toFixed(3),
        H0: +w.H0.toFixed(2),
        H: +H.toFixed(2),
        gamma: +gamma.toFixed(2),
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

  normalAt(x, z, t, eps = 2.0) {
    const hx1 = this.heightAt(x + eps, z, t)
    const hx0 = this.heightAt(x - eps, z, t)
    const hz1 = this.heightAt(x, z + eps, t)
    const hz0 = this.heightAt(x, z - eps, t)
    const n = { x: (hx0 - hx1) / (2 * eps), y: 1, z: (hz0 - hz1) / (2 * eps) }
    const l = Math.hypot(n.x, n.y, n.z)
    return { x: n.x / l, y: n.y / l, z: n.z / l }
  }
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

// --- GLSL twin ---
export const WAVE_GLSL = /* glsl */ `
  uniform vec4 uTrain[${MAX_TRAIN}]; // s, H0, L0, c0
  uniform vec2 uSwellDir; // travel direction (toward shore)
  uniform float uWindU; // offshore wind component, m/s (+ = offshore)

  float depthAt(vec2 p) {
    float base = ${DEPTH_A} * p.x * p.x / (p.x + ${DEPTH_X0.toFixed(1)});
    float bankZ = max(cos((p.y - (${BANK_PEAK_Z.toFixed(1)})) * ${BANK_K.toFixed(6)}), 0.0);
    float bar = ${BAR_H.toFixed(2)} * exp(-pow((p.x - ${BAR_X.toFixed(1)}) / ${BAR_W.toFixed(1)}, 2.0)) * bankZ;
    return max(base - bar, 0.25);
  }

  // xyz = displacement (xz: crest lean), w = foam
  // Twin of waves.js surfaceAt — keep numerically identical.
  vec4 surf(vec2 p) {
    float d = depthAt(p);
    float shore = smoothstep(-2.0, 6.0, p.x);
    float sPos = dot(p, uSwellDir);
    // bottom slope along travel: depth behind minus ahead (+ = shoaling)
    float slope = clamp(
      (depthAt(p - uSwellDir * 8.0) - depthAt(p + uSwellDir * 8.0)) / 16.0,
      0.01, 0.12);
    float wA = 43.8 * (1.0 - exp(-19.0 * slope));
    float wB = 1.56 / (1.0 + exp(-19.5 * slope));
    float windT = tanh(uWindU / 8.0);
    float y = 0.0;
    float foam = 0.0;
    vec2 lean = vec2(0.0);
    for (int i = 0; i < ${MAX_TRAIN}; i++) {
      vec4 W = uTrain[i];
      if (W.y < 1e-4) continue;
      float c = min(sqrt(${G} * d), W.w);
      float T = W.z / W.w;
      float L = max(max(c * T, 0.15 * W.z), 6.0);
      float H = W.y * min(pow(${D_REF.toFixed(1)} / max(d, 0.4), 0.25), 2.2);
      float hFull = 1.2 * H;
      float gamma = clamp(wB - wA * hFull / (${G} * T * T), 0.6, 1.5) * (1.0 + 0.15 * windT);
      float steep = hFull / (gamma * d);
      float brk = smoothstep(0.95, 1.25, steep);
      float xiB = (slope / sqrt(hFull / W.z)) * (1.0 + 0.25 * windT);
      float P = clamp((xiB - 0.4) / 0.8, 0.0, 1.0);
      H = mix(H, 0.4 * d, brk);
      float xi = (sPos - W.x) / L;
      if (abs(xi) > 1.6) continue;
      float wf = 0.12 * (1.05 - 0.5 * min(steep, 1.0));
      float wb = 0.2;
      float u = xi > 0.0 ? xi / wf : xi / wb;
      float kern = exp(-u * u);
      float yw = H * kern;
      float frontGate = smoothstep(-0.3, 0.1, xi);
      float lip = yw - 0.62 * H;
      if (lip > 0.0) {
        float theta = (0.55 * smoothstep(0.8, 1.0, steep) * (0.3 + 0.7 * P)
                     + (0.7 + 0.9 * P) * brk) * frontGate;
        y += yw - lip * (1.0 - cos(theta));
        // pure rotation: forward = lip*sin, down = lip*(1-cos) — a true curl,
        // never a flat forward ramp
        lean += uSwellDir * lip * sin(theta);
      } else {
        y += yw;
      }
      float trail = xi < 0.0 ? exp(-pow(xi / 0.55, 2.0)) : 0.0;
      foam += brk * max(kern, 0.75 * trail);
    }
    return vec4(lean.x, y * shore, lean.y, min(foam, 1.0) * shore);
  }
`
