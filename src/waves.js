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

import { fromDirToVec, BANK_PEAK_Z, BANK_K, SEABED_SLOPE, BREAKER_INDEX } from './geo.js'

export const MAX_TRAIN = 24
const G = 9.81
const D_REF = 12 // depth (m) beyond which shoaling is negligible
const BANK_DEPTH = 0.35 // bank shaves up to 35% off local depth
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
    let f
    if (g === 8 || g === 9 || g === 10) {
      f = [1.0, 1.25, 1.05][g - 8] * (0.92 + Math.random() * 0.16)
    } else {
      f = 0.35 + Math.random() * 0.25
    }
    const T = this.tp * (0.95 + Math.random() * 0.1)
    return {
      s: this._sAt(xStart),
      H0: Math.max(this.hs * f * 1.15, 0.05), // crest height above still water
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
    // break line over the bank, for seating/crowds: H0*green = 0.78 d
    let d = Math.max(this.hs / BREAKER_INDEX, 0.5)
    for (let i = 0; i < 3; i++) {
      const green = Math.min(Math.pow(D_REF / Math.max(d, 0.4), 0.25), 2.2)
      d = Math.max((this.hs * Math.max(green, 1)) / BREAKER_INDEX, 0.5)
    }
    this.faceHeight = d * BREAKER_INDEX
    this.xBreak = Math.max(d / (SEABED_SLOPE * (1 - BANK_DEPTH)), 25)
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
    const bankFade = 1 - smoothstep(150, 400, x)
    const bank = 1 - BANK_DEPTH * Math.max(Math.cos((z - BANK_PEAK_Z) * BANK_K), 0) * bankFade
    return Math.max(SEABED_SLOPE * x * bank, 0.25)
  }

  // Water surface height + foam at a fixed world point.
  surfaceAt(x, z) {
    const d = this.depthAt(x, z)
    const shore = smoothstep(-2, 6, x)
    const sPos = x * this.meanDir.x + z * this.meanDir.z
    let y = 0
    let foam = 0
    for (const w of this.waves) {
      const c = Math.min(Math.sqrt(G * d), w.c0)
      const L = Math.max(c * (w.L0 / w.c0), 6)
      let H = w.H0 * Math.min(Math.pow(D_REF / Math.max(d, 0.4), 0.25), 2.2)
      const steep = (2 * H) / (BREAKER_INDEX * d)
      const brk = smoothstep(0.9, 1.3, steep)
      H = H * (1 - brk) + 0.5 * d * brk
      const xi = (sPos - w.s) / L
      if (xi > 1.6 || xi < -1.6) continue
      const wf = 0.12 * (1.05 - 0.5 * Math.min(steep, 1))
      const wb = 0.2
      const u = xi > 0 ? xi / wf : xi / wb
      const kern = Math.exp(-u * u)
      y += H * kern
      // shallow leading trough ahead of the face
      y -= 0.2 * H * Math.exp(-Math.pow((xi - 2.4 * wf) / (2.2 * wf), 2))
      // foam: on the broken crest, trailing over the water it already crossed
      const trail = xi < 0 ? Math.exp(-Math.pow(xi / 0.55, 2)) : 0
      foam += brk * Math.max(kern, 0.75 * trail)
    }
    return { y: y * shore, foam: Math.min(foam, 1) * shore }
  }

  heightAt(x, z, _t) {
    return this.surfaceAt(x, z).y
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

  float depthAt(vec2 p) {
    float bankFade = 1.0 - smoothstep(150.0, 400.0, p.x);
    float bank = 1.0 - ${BANK_DEPTH} * max(cos((p.y - (${BANK_PEAK_Z.toFixed(1)})) * ${BANK_K.toFixed(6)}), 0.0) * bankFade;
    return max(${SEABED_SLOPE} * p.x * bank, 0.25);
  }

  // xyz = displacement (xz: crest lean), w = foam
  vec4 surf(vec2 p) {
    float d = depthAt(p);
    float shore = smoothstep(-2.0, 6.0, p.x);
    float sPos = dot(p, uSwellDir);
    float y = 0.0;
    float foam = 0.0;
    vec2 lean = vec2(0.0);
    for (int i = 0; i < ${MAX_TRAIN}; i++) {
      vec4 W = uTrain[i];
      if (W.y < 1e-4) continue;
      float c = min(sqrt(${G} * d), W.w);
      float L = max(c * (W.z / W.w), 6.0);
      float H = W.y * min(pow(${D_REF.toFixed(1)} / max(d, 0.4), 0.25), 2.2);
      float steep = 2.0 * H / (${BREAKER_INDEX} * d);
      float brk = smoothstep(0.9, 1.3, steep);
      H = mix(H, 0.5 * d, brk);
      float xi = (sPos - W.x) / L;
      if (abs(xi) > 1.6) continue;
      float wf = 0.12 * (1.05 - 0.5 * min(steep, 1.0));
      float wb = 0.2;
      float u = xi > 0.0 ? xi / wf : xi / wb;
      float kern = exp(-u * u);
      float yw = H * kern;
      y += yw;
      y -= 0.2 * H * exp(-pow((xi - 2.4 * wf) / (2.2 * wf), 2.0));
      // crest leans shoreward as it stands up, lip throws forward as it
      // breaks — quadratic in height so the TOP curls while the base stays
      // planted (no mesh shear at the trough)
      lean += uSwellDir * (0.85 * smoothstep(0.7, 1.0, steep) + 0.35 * brk) * (yw * yw / max(H, 0.3));
      float trail = xi < 0.0 ? exp(-pow(xi / 0.55, 2.0)) : 0.0;
      foam += brk * max(kern, 0.75 * trail);
    }
    return vec4(lean.x, y * shore, lean.y, min(foam, 1.0) * shore);
  }
`
