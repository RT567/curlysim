// Ocean surface renderer for the discrete-wave-train model. Two flat-shaded
// plane tiers displaced in the vertex shader; foam arrives as a varying
// computed by the same wave objects that shape the surface.

import * as THREE from 'three'
import { WAVE_GLSL, MAX_TRAIN } from './waves.js'
import { BANK_PEAK_Z } from './geo.js'

const VERT = /* glsl */ `
  ${WAVE_GLSL}
  varying vec3 vWorldPos;
  varying float vFoam;
  void main() {
    vec2 p = position.xz;
    vec4 sf = surf(p);
    vec3 wp = vec3(p.x + sf.x, position.y + sf.y, p.y + sf.z);
    vWorldPos = wp;
    vFoam = sf.w;
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
  varying vec3 vWorldPos;
  varying float vFoam;

  void main() {
    // derivative normal faces the viewer, so overhanging lip undersides get a
    // real orientation instead of being flipped upright
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    float x = vWorldPos.x;
    float d = depthAt(vWorldPos.xz);

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

    // near field: fine facets around the lineup
    const near = new THREE.PlaneGeometry(520, 760, 460, 640)
    near.rotateX(-Math.PI / 2)
    near.translate(240, 0, BANK_PEAK_Z + 40) // x: -20..500, z: -640..120
    // far field: coarse, slightly sunken so the near tier always wins overlaps
    const far = new THREE.PlaneGeometry(2900, 5200, 180, 230)
    far.rotateX(-Math.PI / 2)
    far.translate(1430, -0.35, BANK_PEAK_Z)

    this.meshNear = new THREE.Mesh(near, this.material)
    this.meshFar = new THREE.Mesh(far, this.material)
    this.meshNear.frustumCulled = false
    this.meshFar.frustumCulled = false
    scene.add(this.meshNear, this.meshFar)
    this.syncWaves()
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
