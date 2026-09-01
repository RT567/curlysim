// The wave model. One table of Gerstner components drives BOTH the GPU ocean
// shader and the CPU sampling used by the camera and surfers — the two
// implementations (GLSL below, JS here) must stay numerically identical.
//
// Components are built from real forecast numbers:
//   - primary swell split into 3 detuned siblings -> beat-frequency envelope
//     gives real sets and lulls (minutes apart, you wait like a real lineup)
//   - secondary swell (2 components) when the forecast reports one
//   - short-wavelength wind chop spread around the wind direction

import { fromDirToVec, BANK_PEAK_Z, BANK_K, SEABED_SLOPE, knotsToMs } from './geo.js'

export const MAX_WAVES = 12
const G = 9.81

export class WaveField {
  constructor() {
    this.components = []
    this.xBreak = 60
    this.faceHeight = 1
    this.bankAmp = 0.28
    // flat uniform arrays for the shader
    this.uA = new Float32Array(MAX_WAVES * 4) // dirx, dirz, k, omega
    this.uB = new Float32Array(MAX_WAVES * 4) // amp, Q, phase, 0
  }

  // conditions: { swells: [{height, period, dir}...], windKn, windDirFrom }
  rebuild(conditions) {
    const comps = []
    const swells = conditions.swells.filter((s) => s.height > 0.02 && s.period > 1)

    // Two systems only: ONE swell train + wind chop. Secondary swell energy is
    // folded into the primary (rms) instead of adding a crisscrossing train.
    let primary = swells[0]
    if (primary && swells[1]) {
      primary = {
        height: Math.hypot(primary.height, swells[1].height * 0.7),
        period: primary.period,
        dir: primary.dir,
      }
    }
    if (primary) {
      // Split H_s across detuned siblings. Sum of amps ~ H_s/2; the near-equal
      // frequencies beat with periods of a few minutes = sets and lulls.
      const a0 = primary.height / 2
      // tight directional spread: swell lines visibly march in from ONE
      // direction; the slight detuning still gives sets and shifting peaks
      const sib = [
        { fA: 0.5, dT: 0, dDir: 0 },
        { fA: 0.3, dT: 0.055, dDir: -4 },
        { fA: 0.2, dT: -0.09, dDir: 3 },
      ]
      for (const s of sib) {
        comps.push(makeComponent(a0 * s.fA, primary.period * (1 + s.dT), primary.dir + s.dDir, 0.38))
      }
    }

    // Wind chop: energy ~ U^2, spread around the wind direction. DISABLED for
    // now — the surface stays clean and only the swell train moves. Re-enable
    // when the chop pass happens.
    const CHOP_ENABLED = false
    const U = knotsToMs(conditions.windKn || 0)
    const aChop = Math.min(0.012 + 0.008 * U * U, 0.6)
    if (CHOP_ENABLED && aChop > 0.01) {
      const spread = [-40, -18, 0, 22, 45]
      const periods = [1.9, 2.4, 2.8, 2.1, 2.6]
      for (let i = 0; i < spread.length; i++) {
        comps.push(
          makeComponent(
            (aChop / spread.length) * (1.6 - 0.2 * i),
            periods[i],
            conditions.windDirFrom + spread[i],
            0.3
          )
        )
      }
    }

    this.components = comps.slice(0, MAX_WAVES)
    this._computeBreak(primary)
    this._packUniforms()
  }

  _computeBreak(primary) {
    // Effective breaking face height: significant height amplified by
    // period-dependent shoaling (long-period groundswell stands up taller).
    let h = 0.4
    if (primary) h = primary.height * (0.8 + 0.04 * Math.min(primary.period, 16))
    this.faceHeight = h
    // break where depth = H / 0.78, depth = slope * x
    this.xBreak = Math.max(h / (0.78 * SEABED_SLOPE), 25)
  }

  _packUniforms() {
    this.uA.fill(0)
    this.uB.fill(0)
    this.components.forEach((c, i) => {
      this.uA[i * 4 + 0] = c.dir.x
      this.uA[i * 4 + 1] = c.dir.z
      this.uA[i * 4 + 2] = c.k
      this.uA[i * 4 + 3] = c.omega
      this.uB[i * 4 + 0] = c.a
      this.uB[i * 4 + 1] = c.Q
      this.uB[i * 4 + 2] = c.phi
    })
  }

  // --- CPU sampling (must mirror the GLSL exactly) ---

  ampScale(x, z) {
    const xb = this.xBreak
    const shore = smoothstep(-2, 6, x)
    const shoal = 1 + 0.7 * (1 - smoothstep(xb, xb + 140, x))
    const broken = mix(0.3, 1, smoothstep(xb * 0.15, xb, x))
    const bankFade = 1 - smoothstep(xb + 120, xb + 320, x)
    const bank = 1 + this.bankAmp * Math.cos((z - BANK_PEAK_Z) * BANK_K) * bankFade
    return shore * shoal * broken * bank
  }

  // Raw surface at parameter point p (Gerstner: the surface point is displaced
  // horizontally away from p).
  _surface(px, pz, t) {
    let dx = 0
    let dz = 0
    let y = 0
    const s = this.ampScale(px, pz)
    for (const c of this.components) {
      const th = c.k * (c.dir.x * px + c.dir.z * pz) - c.omega * t + c.phi
      const ca = Math.cos(th)
      dx += c.Q * c.a * s * c.dir.x * ca
      dz += c.Q * c.a * s * c.dir.z * ca
      y += c.a * s * Math.sin(th)
    }
    // Stokes-ish nonlinearity near the break: crests jack up, troughs stay —
    // this is what makes a set visibly stand up before it breaks.
    const sz = 1 - smoothstep(this.xBreak + 80, this.xBreak + 220, px)
    if (y > 0 && sz > 0) {
      const rel = Math.min(y / Math.max(0.5 * this.faceHeight, 0.2), 1)
      y *= 1 + 0.55 * sz * rel
    }
    return { dx, dz, y }
  }

  // Height of the water surface at a fixed world (x, z): invert the horizontal
  // displacement by fixed-point iteration (2-3 rounds is plenty at swell scale).
  heightAt(x, z, t) {
    let px = x
    let pz = z
    for (let i = 0; i < 3; i++) {
      const s = this._surface(px, pz, t)
      px = x - s.dx
      pz = z - s.dz
    }
    return this._surface(px, pz, t).y
  }

  // Approximate surface normal via central differences of heightAt.
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

function makeComponent(a, T, fromDeg, steepness = 0.25) {
  const omega = (2 * Math.PI) / T
  const k = (omega * omega) / G // deep-water dispersion
  const dir = fromDirToVec(fromDeg)
  // Q chosen so this component contributes k*a*Q = steepness/3 of crest
  // sharpening; capped so the summed field can never loop over itself.
  const Q = Math.min(steepness / (3 * k * a), 0.35 / (k * a))
  return { a, k, omega, dir, Q, phi: Math.random() * Math.PI * 2 }
}

function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}
function mix(a, b, t) {
  return a + (b - a) * t
}

// --- GLSL twin of the functions above, injected into the ocean shader ---
export const WAVE_GLSL = /* glsl */ `
  uniform vec4 uWaveA[${MAX_WAVES}]; // dirx, dirz, k, omega
  uniform vec4 uWaveB[${MAX_WAVES}]; // amp, Q, phase, -
  uniform float uTime;
  uniform float uXBreak;
  uniform float uBankAmp;
  uniform float uFaceH;

  float ampScale(vec2 p) {
    float x = p.x;
    float shore = smoothstep(-2.0, 6.0, x);
    float shoal = 1.0 + 0.7 * (1.0 - smoothstep(uXBreak, uXBreak + 140.0, x));
    float broken = mix(0.3, 1.0, smoothstep(uXBreak * 0.15, uXBreak, x));
    float bankFade = 1.0 - smoothstep(uXBreak + 120.0, uXBreak + 320.0, x);
    float bank = 1.0 + uBankAmp * cos((p.y - (${BANK_PEAK_Z.toFixed(1)})) * ${BANK_K.toFixed(6)}) * bankFade;
    return shore * shoal * broken * bank;
  }

  vec3 gerstner(vec2 p) {
    vec3 res = vec3(0.0);
    float s = ampScale(p);
    for (int i = 0; i < ${MAX_WAVES}; i++) {
      vec4 A = uWaveA[i];
      vec4 B = uWaveB[i];
      if (B.x < 1e-5) continue;
      float th = A.z * dot(A.xy, p) - A.w * uTime + B.z;
      float c = cos(th);
      res.x += B.y * B.x * s * A.x * c;
      res.z += B.y * B.x * s * A.y * c;
      res.y += B.x * s * sin(th);
    }
    // crest jacking near the break (must match waves.js _surface)
    float sz = 1.0 - smoothstep(uXBreak + 80.0, uXBreak + 220.0, p.x);
    if (res.y > 0.0 && sz > 0.0) {
      float rel = clamp(res.y / max(0.5 * uFaceH, 0.2), 0.0, 1.0);
      res.y *= 1.0 + 0.55 * sz * rel;
    }
    return res;
  }
`
