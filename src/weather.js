// Clouds and rain. Clouds are instanced flat-shaded blobs drifting downwind,
// count scaled by cloud cover; rain is a recycled Points box that follows the
// camera, tilted by the wind.

import * as THREE from 'three'
import { fromDirToVec, knotsToMs } from './geo.js'

const MAX_CLOUDS = 44
const RAIN_COUNT = 1500
const RAIN_BOX = { w: 90, h: 55, d: 90 }

export class Weather {
  constructor(scene) {
    const geo = new THREE.DodecahedronGeometry(1, 0)
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      flatShading: true,
    })
    this.clouds = new THREE.InstancedMesh(geo, this.cloudMat, MAX_CLOUDS)
    this.cloudSeeds = []
    const mtx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const seed = {
        x: THREE.MathUtils.randFloatSpread(5000),
        z: THREE.MathUtils.randFloatSpread(5600),
        y: 420 + Math.random() * 260,
        sx: 55 + Math.random() * 90,
        sy: 9 + Math.random() * 7,
        sz: 40 + Math.random() * 60,
        rot: Math.random() * Math.PI,
      }
      // keep the sky over the lineup clear so no slab ever fills the lens
      if (Math.hypot(seed.x - 250, seed.z + 300) < 900) {
        seed.x += seed.x > 250 ? 900 : -900
      }
      this.cloudSeeds.push(seed)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seed.rot)
      mtx.compose(new THREE.Vector3(seed.x, seed.y, seed.z), q, new THREE.Vector3(seed.sx, seed.sy, seed.sz))
      this.clouds.setMatrixAt(i, mtx)
    }
    this.clouds.count = 0
    scene.add(this.clouds)

    // rain
    const rainPos = new Float32Array(RAIN_COUNT * 3)
    for (let i = 0; i < RAIN_COUNT; i++) {
      rainPos[i * 3] = THREE.MathUtils.randFloatSpread(RAIN_BOX.w)
      rainPos[i * 3 + 1] = Math.random() * RAIN_BOX.h
      rainPos[i * 3 + 2] = THREE.MathUtils.randFloatSpread(RAIN_BOX.d)
    }
    this.rainGeo = new THREE.BufferGeometry()
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
    this.rain = new THREE.Points(
      this.rainGeo,
      new THREE.PointsMaterial({ color: 0xaebfca, size: 0.14, transparent: true, opacity: 0.55 })
    )
    this.rain.visible = false
    scene.add(this.rain)

    this._mtx = mtx
    this._q = q
  }

  setConditions(conditions) {
    const cover = (conditions.cloudCover ?? 0) / 100
    this.clouds.count = Math.round(MAX_CLOUDS * cover)
    const raining = (conditions.precip ?? 0) > 0.05
    const grey = 1 - 0.45 * cover - (raining ? 0.2 : 0)
    this.cloudMat.color.setScalar(Math.max(grey, 0.35))
    this.rain.visible = raining
    this.windVec = fromDirToVec(conditions.windDirFrom || 0)
    this.windMs = knotsToMs(conditions.windKn || 0)
  }

  update(dt, t, camera) {
    // drift clouds downwind, wrap around the world
    const drift = (2 + this.windMs * 0.5 || 2) * dt
    for (let i = 0; i < this.clouds.count; i++) {
      const s = this.cloudSeeds[i]
      s.x += (this.windVec?.x ?? 0.5) * drift
      s.z += (this.windVec?.z ?? 0.5) * drift
      if (s.x > 2600) s.x -= 5200
      if (s.x < -2600) s.x += 5200
      if (s.z > 2900) s.z -= 5800
      if (s.z < -2900) s.z += 5800
      this._q.setFromAxisAngle(_UP, s.rot)
      this._mtx.compose(_V.set(s.x, s.y, s.z), this._q, _S.set(s.sx, s.sy, s.sz))
      this.clouds.setMatrixAt(i, this._mtx)
    }
    if (this.clouds.count > 0) this.clouds.instanceMatrix.needsUpdate = true

    if (this.rain.visible) {
      const pos = this.rainGeo.attributes.position
      const fall = 22 * dt
      const wx = (this.windVec?.x ?? 0) * this.windMs * 0.7 * dt
      const wz = (this.windVec?.z ?? 0) * this.windMs * 0.7 * dt
      for (let i = 0; i < RAIN_COUNT; i++) {
        let y = pos.getY(i) - fall
        if (y < 0) y += RAIN_BOX.h
        pos.setY(i, y)
        let x = pos.getX(i) + wx
        let z = pos.getZ(i) + wz
        if (x > RAIN_BOX.w / 2) x -= RAIN_BOX.w
        if (x < -RAIN_BOX.w / 2) x += RAIN_BOX.w
        if (z > RAIN_BOX.d / 2) z -= RAIN_BOX.d
        if (z < -RAIN_BOX.d / 2) z += RAIN_BOX.d
        pos.setX(i, x)
        pos.setZ(i, z)
      }
      pos.needsUpdate = true
      this.rain.position.set(camera.position.x, camera.position.y - 10, camera.position.z)
    }
  }
}

const _UP = new THREE.Vector3(0, 1, 0)
const _V = new THREE.Vector3()
const _S = new THREE.Vector3()
