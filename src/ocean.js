// Ocean surface: two flat-shaded plane tiers (fine near field, coarse far
// field) displaced by the shared Gerstner field in the vertex shader.
// Flat low-poly facets come free from derivative normals in the fragment
// shader, so the geometry stays indexed and cheap.

import * as THREE from 'three'
import { WAVE_GLSL, MAX_WAVES } from './waves.js'
import { BANK_PEAK_Z } from './geo.js'

const VERT = /* glsl */ `
  ${WAVE_GLSL}
  varying vec3 vWorldPos;
  void main() {
    vec2 p = position.xz;
    vec3 g = gerstner(p);
    vec3 wp = vec3(p.x + g.x, position.y + g.y, p.y + g.z);
    vWorldPos = wp;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform float uXBreak;
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

  void main() {
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (n.y < 0.0) n = -n;
    float x = vWorldPos.x;
    float d = max(0.02 * x, 0.25); // local depth

    // Exaggerated shading normal: real ocean slopes are a few degrees, which
    // reads as dead-flat in lambert shading — steepen for the stylized look.
    vec3 ns = normalize(vec3(n.x * 3.5, n.y, n.z * 3.5));

    float shallowMix = 1.0 - smoothstep(1.5, 14.0, d);
    vec3 base = mix(uDeepColor, uShallowColor, shallowMix);

    // Foam wherever the wave is near its breaking limit (H ~ 0.78 d): deep
    // water never foams, set waves foam further out, whitewater rolls in.
    float rel = vWorldPos.y / max(0.35 * d, 0.12);
    float crest = smoothstep(0.62, 0.85, rel);
    float shoreWash = 1.0 - smoothstep(2.0, 12.0, x);
    float slope = length(n.xz) / max(n.y, 0.2);
    float caps = uWhitecaps * smoothstep(0.05, 0.11, slope);
    float foam = max(max(crest, shoreWash), caps);
    base = mix(base, uFoamColor, foam);

    float diff = max(dot(ns, uSunDir), 0.0);
    vec3 amb = mix(uGroundAmbient, uSkyAmbient, ns.y * 0.5 + 0.5);
    vec3 col = base * (amb + uSunColor * diff);

    // fresnel-ish sky reflection: makes swell lines readable at a distance
    vec3 v = normalize(uCamPos - vWorldPos);
    float fres = pow(1.0 - max(dot(ns, v), 0.0), 4.0);
    col = mix(col, uFogColor, fres * (1.0 - foam) * 0.45);

    // sun sparkle on facets
    vec3 r = reflect(-uSunDir, ns);
    float spec = pow(max(dot(r, v), 0.0), 140.0);
    col += uSunColor * spec * (1.0 - foam) * 0.9;

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
      uWaveA: { value: new Float32Array(MAX_WAVES * 4) },
      uWaveB: { value: new Float32Array(MAX_WAVES * 4) },
      uTime: { value: 0 },
      uXBreak: { value: 60 },
      uBankAmp: { value: 0.28 },
      uFaceH: { value: 1 },
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
    this.uniforms.uWaveA.value.set(this.waveField.uA)
    this.uniforms.uWaveB.value.set(this.waveField.uB)
    this.uniforms.uXBreak.value = this.waveField.xBreak
    this.uniforms.uBankAmp.value = this.waveField.bankAmp
    this.uniforms.uFaceH.value = this.waveField.faceHeight
  }

  update(t, camera, env) {
    this.uniforms.uTime.value = t
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
