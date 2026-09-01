// Sky, sun, moon, stars, lights, fog. suncalc gives the real sun/moon position
// for Curl Curl at the current clock time; everything else (light color, fog,
// water tint, night overlay) is lerped off sun altitude and the weather.

import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import SunCalc from 'suncalc'
import { LAT, LON, BEACH_FACING } from './geo.js'

const DEG = Math.PI / 180

// suncalc azimuth is measured from SOUTH, positive toward the west.
// Compass bearing = azimuth + 180deg.
function celestialToWorld(pos) {
  const bearing = pos.azimuth / DEG + 180
  const a = (bearing - BEACH_FACING) * DEG
  const cosAlt = Math.cos(pos.altitude)
  return new THREE.Vector3(Math.cos(a) * cosAlt, Math.sin(pos.altitude), Math.sin(a) * cosAlt)
}

function lerpColor(out, a, b, t) {
  return out.copy(a).lerp(b, THREE.MathUtils.clamp(t, 0, 1))
}

const C = {
  sunHigh: new THREE.Color(0xfff4e0),
  sunLow: new THREE.Color(0xffb36b),
  fogDay: new THREE.Color(0xc8dbe4),
  fogDusk: new THREE.Color(0xe0a97e),
  fogNight: new THREE.Color(0x10161f),
  fogRain: new THREE.Color(0x8fa0aa),
  skyAmbDay: new THREE.Color(0xbdd8e6),
  skyAmbNight: new THREE.Color(0x1a2433),
  groundAmbDay: new THREE.Color(0x4d6157),
  groundAmbNight: new THREE.Color(0x0d1214),
  deepDay: new THREE.Color(0x146072),
  deepGrey: new THREE.Color(0x3a545c),
  deepNight: new THREE.Color(0x081820),
  shallowDay: new THREE.Color(0x41a89e),
  shallowGrey: new THREE.Color(0x54747a),
  shallowNight: new THREE.Color(0x0e2a30),
}

export class SkySystem {
  constructor(scene) {
    this.scene = scene

    this.sky = new Sky()
    this.sky.scale.setScalar(9000)
    scene.add(this.sky)
    const u = this.sky.material.uniforms
    u.turbidity.value = 6
    u.rayleigh.value = 1.6
    u.mieCoefficient.value = 0.005
    u.mieDirectionalG.value = 0.8

    // night: dark dome faded in over the day sky (the Preetham sky misbehaves
    // with the sun far below the horizon, so we cover it instead)
    this.nightDome = new THREE.Mesh(
      new THREE.SphereGeometry(8500, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x070c16,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      })
    )
    this.nightDome.renderOrder = -9
    scene.add(this.nightDome)

    // stars
    const starPos = []
    for (let i = 0; i < 1400; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(8000)
      if (v.y > 60) starPos.push(v.x, v.y, v.z)
    }
    this.stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({ color: 0xcfd8ee, size: 9, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false })
    )
    this.stars.renderOrder = -8
    scene.add(this.stars)

    // moon: flat disc billboard
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(140, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8ecf2, transparent: true, opacity: 0, fog: false, depthWrite: false })
    )
    this.moon.renderOrder = -7
    scene.add(this.moon)

    this.sunLight = new THREE.DirectionalLight(0xffffff, 2)
    scene.add(this.sunLight)
    this.hemi = new THREE.HemisphereLight(0xbdd8e6, 0x4d6157, 0.6)
    scene.add(this.hemi)

    scene.fog = new THREE.FogExp2(0xc8dbe4, 0.0011)

    // env consumed by the ocean shader each frame
    this.env = {
      sunDir: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(),
      skyAmbient: new THREE.Color(),
      groundAmbient: new THREE.Color(),
      waterDeep: new THREE.Color(),
      waterShallow: new THREE.Color(),
      fogColor: new THREE.Color(),
      fogDensity: 0.0011,
      whitecaps: 0,
      sunAltitudeDeg: 45,
      dayFactor: 1,
    }
    this._tmp = new THREE.Color()
  }

  update(date, conditions, camera) {
    const sun = SunCalc.getPosition(date, LAT, LON)
    const moon = SunCalc.getMoonPosition(date, LAT, LON)
    let altDeg = sun.altitude / DEG
    let sunPos = sun
    // No night in this sim: when the real sun is down, hold a late-morning sun
    if (altDeg < 12) {
      altDeg = 38
      sunPos = { azimuth: (25 - 180) * DEG, altitude: 38 * DEG }
    }
    const env = this.env
    env.sunAltitudeDeg = altDeg

    const cloud = (conditions.cloudCover ?? 0) / 100
    const raining = (conditions.precip ?? 0) > 0.05
    const day = THREE.MathUtils.smoothstep(altDeg, -6, 6) // 0 night .. 1 day
    const dusk = 1 - Math.min(Math.abs(altDeg) / 12, 1) // 1 near horizon
    env.dayFactor = day

    // sky dome: keep the shader sun from sinking too far below the horizon
    const sunDir = celestialToWorld(sunPos)
    const skySun = sunDir.clone()
    skySun.y = Math.max(skySun.y, -0.08)
    this.sky.material.uniforms.sunPosition.value.copy(skySun)
    this.sky.material.uniforms.turbidity.value = 6 + cloud * 8 + (raining ? 6 : 0)
    this.sky.material.uniforms.rayleigh.value = 1.6 + cloud * 1.2

    env.sunDir.copy(sunDir)
    if (env.sunDir.y < 0.02) env.sunDir.y = 0.02
    env.sunDir.normalize()

    const sunStrength = day * (1 - 0.75 * cloud) * (raining ? 0.5 : 1)
    lerpColor(env.sunColor, C.sunLow, C.sunHigh, THREE.MathUtils.clamp(altDeg / 25, 0, 1))
    env.sunColor.multiplyScalar(sunStrength)

    lerpColor(env.skyAmbient, C.skyAmbNight, C.skyAmbDay, day)
    env.skyAmbient.multiplyScalar(1 - 0.3 * cloud)
    lerpColor(env.groundAmbient, C.groundAmbNight, C.groundAmbDay, day)

    // water tint: grey when overcast, dark at night
    lerpColor(this._tmp, C.deepDay, C.deepGrey, cloud * 0.8 + (raining ? 0.2 : 0))
    lerpColor(env.waterDeep, C.deepNight, this._tmp, day)
    lerpColor(this._tmp, C.shallowDay, C.shallowGrey, cloud * 0.8 + (raining ? 0.2 : 0))
    lerpColor(env.waterShallow, C.shallowNight, this._tmp, day)

    // fog: day/dusk/night blend, denser + greyer in rain
    lerpColor(env.fogColor, C.fogNight, C.fogDay, day)
    if (dusk > 0 && !raining) env.fogColor.lerp(C.fogDusk, dusk * day * 0.7)
    if (raining) env.fogColor.lerp(C.fogRain, 0.7 * day)
    env.fogDensity = 0.0011 * (raining ? 2.4 : 1) * (1 + cloud * 0.3)
    this.scene.fog.color.copy(env.fogColor)
    this.scene.fog.density = env.fogDensity

    // whitecaps offshore once the wind is up
    env.whitecaps = THREE.MathUtils.clamp(((conditions.windKn ?? 0) - 11) / 16, 0, 1) * 0.9

    // three.js lights for terrain / surfers / clouds
    this.sunLight.position.copy(env.sunDir).multiplyScalar(1000)
    this.sunLight.intensity = 2.6 * sunStrength + 0.02
    this.sunLight.color.copy(env.sunColor).multiplyScalar(sunStrength > 0 ? 1 / Math.max(sunStrength, 0.05) : 1)
    this.hemi.color.copy(env.skyAmbient)
    this.hemi.groundColor.copy(env.groundAmbient)
    this.hemi.intensity = 0.15 + 0.65 * day

    // night dressing
    const night = 1 - day
    this.nightDome.material.opacity = night * 0.92
    this.stars.material.opacity = night * (1 - cloud * 0.85)
    const moonUp = moon.altitude > 0
    const moonDir = celestialToWorld(moon)
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 7800)
    this.moon.lookAt(camera.position)
    const moonFrac = SunCalc.getMoonIllumination(date).fraction
    this.moon.material.opacity = (moonUp ? 1 : 0) * night * (0.35 + 0.6 * moonFrac) * (1 - cloud * 0.8)
    if (night > 0.5 && moonUp) {
      // moonlight keeps the scene faintly readable
      this.sunLight.position.copy(moonDir).multiplyScalar(1000)
      this.sunLight.intensity = 0.12 * moonFrac * (1 - cloud * 0.8)
      this.sunLight.color.set(0x9fb2d8)
      env.sunDir.copy(moonDir)
      if (env.sunDir.y < 0.02) env.sunDir.y = 0.02
      env.sunColor.set(0x39445c).multiplyScalar(0.4 * moonFrac)
    }

    // keep the sky centred on the camera so the dome never clips
    this.sky.position.copy(camera.position)
    this.nightDome.position.copy(camera.position)
    this.stars.position.copy(camera.position)

    return env
  }
}
