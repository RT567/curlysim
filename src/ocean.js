// Ocean surface renderer for the discrete-wave-train model. Two flat-shaded
// plane tiers displaced in the vertex shader; foam arrives as a varying
// computed by the same wave objects that shape the surface.

import * as THREE from 'three'
import { WAVE_GLSL, MAX_TRAIN } from './waves.js'
import { BANK_PEAK_Z } from './geo.js'
import { QUALITY } from './quality.js'

const VERT = /* glsl */ `
  ${WAVE_GLSL}
  varying vec3 vWorldPos;
  varying float vFoam;
  varying float vPhase;
  varying float vDepth;
  void main() {
    vec2 p = position.xz;
    vec4 sf = surf(p);
    vec3 wp = vec3(p.x + sf.x, position.y + sf.y, p.y + sf.z);
    vWorldPos = wp;
    // still-water depth under the displaced point, per vertex: smooth at the
    // facet scale, and saves the seabed function per pixel
    vDepth = depthAt(wp.xz);
    vFoam = sf.w;
    vPhase = gPhase;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`

const FRAG = /* glsl */ `
  ${WAVE_GLSL}
  uniform float uWhitecaps;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyAmbient;
  uniform vec3 uGroundAmbient;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uFoamColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uCamPos;
  uniform float uPhaseDebug;
  varying vec3 vWorldPos;
  varying float vFoam;
  varying float vPhase;
  varying float vDepth;

  void main() {
    // derivative normal faces the viewer, so overhanging lip undersides get a
    // real orientation instead of being flipped upright
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float x = vWorldPos.x;
    float d = vDepth;

    // shading normal slightly exaggerated so facets read
    vec3 ns = normalize(vec3(n.x * 3.0, n.y, n.z * 3.0));

    float shallowMix = 1.0 - smoothstep(1.5, 14.0, d);
    vec3 base = mix(uDeepColor, uShallowColor, shallowMix);

    // wave-face tint: rising front faces go a touch greener/darker
    float ht = clamp(vWorldPos.y / max(0.6 * d, 0.3), 0.0, 1.0);
    base *= 0.92 + 0.16 * ht;

    // underside of a thrown lip: dark shadowed emerald ceiling
    float under = smoothstep(0.05, -0.2, n.y);
    base = mix(base, base * vec3(0.45, 0.72, 0.66), under);

    // foam DISABLED for now (wave-train foam, shore wash, whitecaps all off)
    float foam = 0.0;
    base = mix(base, uFoamColor, foam);

    // phase debug tint: yellow = standing, orange = breaking, red = bore
    if (uPhaseDebug > 0.5) {
      vec3 tint = base;
      tint = mix(tint, vec3(0.95, 0.85, 0.2), smoothstep(0.7, 0.8, vPhase) * (1.0 - smoothstep(0.95, 1.0, vPhase)));
      tint = mix(tint, vec3(0.95, 0.5, 0.15), smoothstep(0.95, 1.0, vPhase) * (1.0 - smoothstep(1.25, 1.35, vPhase)));
      tint = mix(tint, vec3(0.85, 0.15, 0.15), smoothstep(1.25, 1.4, vPhase));
      base = mix(base, tint, 0.65);
    }

    float diff = max(dot(ns, uSunDir), 0.0);
    vec3 amb = mix(uGroundAmbient, uSkyAmbient, ns.y * 0.5 + 0.5);
    vec3 col = base * (amb + uSunColor * diff);

    // grid so wave shape and motion always read on the clean surface
    vec2 gp = vWorldPos.xz / 2.5;
    vec2 gw = fwidth(gp);
    vec2 gl = abs(fract(gp - 0.5) - 0.5) / max(gw * 2.0, vec2(1e-4));
    float line = 1.0 - min(min(gl.x, gl.y), 1.0);
    float gridFade = 1.0 - smoothstep(180.0, 500.0, length(vWorldPos.xz - uCamPos.xz));
    col *= 1.0 - line * 0.32 * gridFade * (1.0 - foam);

    // fresnel sky reflection (true normal: horizon-band effect)
    vec3 v = normalize(uCamPos - vWorldPos);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    col = mix(col, uFogColor, fres * (1.0 - foam) * 0.4);

    // sun glitter hugging the sun path
    vec3 r = reflect(-uSunDir, n);
    float spec = pow(max(dot(r, v), 0.0), 180.0) * pow(1.0 - max(dot(n, v), 0.0), 1.5);
    col += uSunColor * spec * (1.0 - foam) * 1.2;

    float dist = length(vWorldPos - uCamPos);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export class Ocean {
  constructor(scene, waveField) {
    this.waveField = waveField
    this.uniforms = {
      uTrain: { value: waveField.uT }, // live reference: CPU writes, GPU reads
      uSwellDir: { value: new THREE.Vector2(-1, 0) },
      uWindU: { value: 0 },
      uPhaseDebug: { value: 0 }, // wave-phase tint; toggled from the ?debug panel
      uWhitecaps: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xffffff) },
      uSkyAmbient: { value: new THREE.Color(0xbcd9e8) },
      uGroundAmbient: { value: new THREE.Color(0x3d554d) },
      uDeepColor: { value: new THREE.Color(0x145e70) },
      uShallowColor: { value: new THREE.Color(0x3fa8a0) },
      uFoamColor: { value: new THREE.Color(0xf2f7f5) },
      uFogColor: { value: new THREE.Color(0xc8dbe4) },
      uFogDensity: { value: 0.0011 },
      uCamPos: { value: new THREE.Vector3() },
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
    })

    // near field: fine facets around the lineup (x -20..500, z -640..120);
    // far field: coarse strips forming a FRAME around the near tier. They
    // never overlap it, so coarse triangles can never poke through steep
    // faces. Each tier is cut into tiles so the ones outside the view are
    // culled (the vertex shader is the expensive part); tile edges share
    // bit-identical vertices, so there are no seams. QUALITY.ocean thins the
    // grids on phones.
    const r = QUALITY.ocean
    this.meshes = []
    const nz0 = BANK_PEAK_Z - 340 // -640
    this._tier(-20, 500, nz0, nz0 + 760, 460 * r, 640 * r, 0, 4, 6) // near
    this._tier(500, 2880, -2600, 2300, 240 * r, 260 * r, -0.08, 3, 3) // out to sea (smooth swell)
    this._tier(-20, 500, -2900, -640, 130 * r, 420 * r, -0.08, 1, 3) // north: carries visible surf
    this._tier(-20, 500, 120, 2300, 130 * r, 320 * r, -0.08, 1, 3) // south: carries visible surf
    for (const m of this.meshes) scene.add(m)
    this.syncWaves()
  }

  // a flat grid of nx x nz cells over [x0,x1] x [z0,z1] at height y, split
  // into tx x tz tiles. Only positions: the shader needs nothing else.
  _tier(x0, x1, z0, z1, nx, nz, y, tx, tz) {
    nx = Math.max(Math.round(nx), tx)
    nz = Math.max(Math.round(nz), tz)
    const dx = (x1 - x0) / nx
    const dz = (z1 - z0) / nz
    for (let a = 0; a < tx; a++) {
      for (let b = 0; b < tz; b++) {
        const i0 = Math.round((nx * a) / tx)
        const i1 = Math.round((nx * (a + 1)) / tx)
        const k0 = Math.round((nz * b) / tz)
        const k1 = Math.round((nz * (b + 1)) / tz)
        const g = gridTile(x0, z0, dx, dz, i0, i1, k0, k1, y)
        // waves lift the surface up to ~20 m and lean crests a few metres
        // shoreward: pad the bounds so a tile is never culled while visible
        g.boundingBox = new THREE.Box3(
          new THREE.Vector3(x0 + i0 * dx - PAD, -PAD, z0 + k0 * dz - PAD),
          new THREE.Vector3(x0 + i1 * dx + PAD, PAD, z0 + k1 * dz + PAD)
        )
        g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere())
        this.meshes.push(new THREE.Mesh(g, this.material))
      }
    }
  }

  syncWaves() {
    this.uniforms.uSwellDir.value.set(this.waveField.meanDir.x, this.waveField.meanDir.z)
    this.uniforms.uWindU.value = this.waveField.windU || 0
  }

  update(t, camera, env) {
    this.uniforms.uCamPos.value.copy(camera.position)
    if (env) {
      this.uniforms.uSunDir.value.copy(env.sunDir)
      this.uniforms.uSunColor.value.copy(env.sunColor)
      this.uniforms.uSkyAmbient.value.copy(env.skyAmbient)
      this.uniforms.uGroundAmbient.value.copy(env.groundAmbient)
      this.uniforms.uDeepColor.value.copy(env.waterDeep)
      this.uniforms.uShallowColor.value.copy(env.waterShallow)
      this.uniforms.uFogColor.value.copy(env.fogColor)
      this.uniforms.uFogDensity.value = env.fogDensity
      this.uniforms.uWhitecaps.value = env.whitecaps
    }
  }
}

const PAD = 25 // m: tile bounds padding for wave displacement

// cells [i0,i1) x [k0,k1) of a global grid; vertex (i, k) sits at
// (x0 + i dx, z0 + k dz) computed from the GLOBAL indices, so neighbouring
// tiles produce identical edge vertices. Same triangulation (and diagonal) as
// a PlaneGeometry rotated flat, facing up.
function gridTile(x0, z0, dx, dz, i0, i1, k0, k1, y) {
  const cols = i1 - i0 + 1
  const rows = k1 - k0 + 1
  const pos = new Float32Array(cols * rows * 3)
  let p = 0
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      pos[p++] = x0 + i * dx
      pos[p++] = y
      pos[p++] = z0 + k * dz
    }
  }
  const idx = new (cols * rows > 65535 ? Uint32Array : Uint16Array)((cols - 1) * (rows - 1) * 6)
  let q = 0
  for (let k = 0; k < rows - 1; k++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = k * cols + i // (i, k)
      const b = (k + 1) * cols + i // (i, k+1)
      const c = (k + 1) * cols + i + 1 // (i+1, k+1)
      const d = k * cols + i + 1 // (i+1, k)
      idx[q++] = a
      idx[q++] = b
      idx[q++] = d
      idx[q++] = b
      idx[q++] = c
      idx[q++] = d
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  return g
}
