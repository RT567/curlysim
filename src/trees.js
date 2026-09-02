// Shoreline Norfolk pines that lean and sway downwind — a live wind gauge.
// Lean angle scales with wind speed; gusty per-tree sway rides on top.

import * as THREE from 'three'
import { fromDirToVec, knotsToMs } from './geo.js'
import { terrainHeight } from './terrain.js'

const COUNT = 60

export class Trees {
  constructor(scene) {
    const geo = new THREE.ConeGeometry(2.4, 10, 6)
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e6b4a, roughness: 1, flatShading: true })
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT)
    this.seeds = []

    // a deliberate line of pines along the beachfront, then scattered park/dune trees
    let placed = 0
    for (let z = -560; z <= 60 && placed < 24; z += 26) {
      const x = -30 - Math.random() * 18
      const y = terrainHeight(x, z + THREE.MathUtils.randFloatSpread(8))
      if (y < 0.4) continue
      this.seeds.push(this._seed(x, y, z))
      placed++
    }
    let guard = 0
    while (this.seeds.length < COUNT && guard++ < 600) {
      const z = THREE.MathUtils.randFloatSpread(1500) - 50
      if (Math.abs(z + 350) < 90) continue // lagoon
      const x = -45 - Math.random() * 110
      const y = terrainHeight(x, z)
      if (y < 0.5 || y > 24) continue
      this.seeds.push(this._seed(x, y, z))
    }
    this.mesh.count = this.seeds.length
    scene.add(this.mesh)

    this.windVec = { x: -1, z: 0 }
    this.windMs = 0
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._axis = new THREE.Vector3()
    this._pos = new THREE.Vector3()
    this._scl = new THREE.Vector3()
    this._lift = new THREE.Matrix4()
  }

  _seed(x, y, z) {
    return {
      x,
      y,
      z,
      s: 0.7 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      rate: 1.0 + Math.random() * 0.7,
    }
  }

  setConditions(conditions) {
    this.windVec = fromDirToVec(conditions.windDirFrom ?? 290) // travel direction
    this.windMs = knotsToMs(conditions.windKn ?? 0)
  }

  update(t) {
    const lean = Math.min(this.windMs * 0.014, 0.38)
    const gust = 0.015 + this.windMs * 0.007
    // rotation axis perpendicular to wind travel: tips the crown downwind
    this._axis.set(this.windVec.z, 0, -this.windVec.x).normalize()
    for (let i = 0; i < this.seeds.length; i++) {
      const s = this.seeds[i]
      const ang = lean + gust * Math.sin(t * s.rate + s.phase)
      this._q.setFromAxisAngle(this._axis, ang)
      // pivot at the trunk base: translate to base, rotate, lift cone to stand
      this._m.compose(this._pos.set(s.x, s.y, s.z), this._q, this._scl.set(s.s, s.s, s.s))
      this._lift.makeTranslation(0, 5, 0)
      this._m.multiply(this._lift)
      this.mesh.setMatrixAt(i, this._m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
