// The crowd. Count comes from a quality x human-factors model:
// wave quality (face size sweet spot, period, wind) times time-of-day /
// day-of-week / daylight factors. Placement follows real Curl Curl habit:
// spread across the mid-beach peaks on clean days, huddled in the
// semi-sheltered north corner when the NE'er is on, empty when it's junk.

import * as THREE from 'three'
import { BANK_PEAK_Z, BANK_WAVELENGTH, fromDirToVec } from './geo.js'

const MAX_SURFERS = 14

export function crowdModel(conditions, faceHeight, date, sunAltitudeDeg) {
  // wave quality 0..1
  const h = faceHeight
  const size = Math.min(Math.max((h - 0.5) / 0.5, 0), 1) * (1 - Math.min(Math.max((h - 2.8) / 2.2, 0), 0.7))
  const period = conditions.swells[0] ? Math.min(conditions.swells[0].period / 13, 1.15) : 0.5
  const windVec = fromDirToVec(conditions.windDirFrom || 0)
  const offshore = windVec.x // +1 blowing straight out to sea
  const kn = conditions.windKn || 0
  let wind
  if (kn < 5) wind = 1
  else if (offshore > 0.15) wind = 1 - Math.min(Math.max((kn - 22) / 15, 0), 0.6)
  else wind = 1 - Math.min(Math.max((kn - 6) / 12, 0), 1) * 0.92
  const rain = (conditions.precip || 0) > 0.3 ? 0.6 : 1
  const quality = Math.min(size * period * wind * rain, 1)

  // human factors
  const daylight = sunAltitudeDeg > -2 ? 1 : 0
  const hour = date.getHours() + date.getMinutes() / 60
  const dow = date.getDay()
  const weekend = dow === 0 || dow === 6
  let timeF
  if (weekend) {
    timeF = 0.25 + 0.95 * Math.exp(-((hour - 9.5) ** 2) / 18)
  } else {
    const dawn = Math.exp(-((hour - 6.8) ** 2) / 2.6)
    const arvo = 0.75 * Math.exp(-((hour - 16.8) ** 2) / 3.2)
    timeF = 0.2 + Math.max(dawn, arvo)
  }
  const month = date.getMonth()
  const season = month >= 9 || month <= 3 ? 1.1 : 0.9 // warmer months busier

  let count = Math.round(MAX_SURFERS * quality * timeF * season) * daylight
  if (quality < 0.14) count = 0
  return { count: Math.min(count, MAX_SURFERS), quality }
}

function makeSurfer() {
  const g = new THREE.Group()
  const boardColors = [0xf2f0e8, 0xe8b84b, 0x7fc4d8, 0xd87f6a, 0x9fd88f]
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.12, 0.5),
    new THREE.MeshStandardMaterial({
      color: boardColors[(Math.random() * boardColors.length) | 0],
      roughness: 0.7,
    })
  )
  board.position.y = 0.06
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.58, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 1 }) // wetsuit
  )
  torso.position.y = 0.45
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.12, 0),
    new THREE.MeshStandardMaterial({ color: 0xd9a878, roughness: 1, flatShading: true })
  )
  head.position.y = 0.85
  g.add(board, torso, head)
  return g
}

export class Surfers {
  constructor(scene, waveField) {
    this.waveField = waveField
    this.group = new THREE.Group()
    scene.add(this.group)
    this.surfers = []
    for (let i = 0; i < MAX_SURFERS; i++) {
      const s = makeSurfer()
      s.visible = false
      s.userData.phase = Math.random() * Math.PI * 2
      this.group.add(s)
      this.surfers.push(s)
    }
    this.count = 0
  }

  // (re)seat the crowd for the current conditions
  populate(conditions, faceHeight, date, sunAltitudeDeg) {
    const { count } = crowdModel(conditions, faceHeight, date, sunAltitudeDeg)
    this.count = count

    const windVec = fromDirToVec(conditions.windDirFrom || 0)
    const kn = conditions.windKn || 0
    // NE seabreeze (side-onshore from the north side) pushes everyone to the
    // sheltered corner under the north headland
    const northCorner = kn > 9 && windVec.z > 0.35 && windVec.x < 0.2

    const xb = this.waveField.xBreak
    for (let i = 0; i < MAX_SURFERS; i++) {
      const s = this.surfers[i]
      s.visible = i < count
      if (!s.visible) continue
      let z
      if (northCorner) {
        z = -480 - Math.random() * 130
      } else {
        // cluster on the A-frame peaks either side of us
        const peak = BANK_PEAK_Z + (((Math.random() * 3) | 0) - 1) * BANK_WAVELENGTH
        z = peak + THREE.MathUtils.randFloatSpread(70)
      }
      // straddle the takeoff zone just inside the break, like the camera
      const x = xb - 45 + Math.random() * 35
      // don't sit in our lap
      if (Math.abs(z - BANK_PEAK_Z) < 14 && Math.abs(x - (xb - 35)) < 14) z += 20
      s.userData.seat = { x, z }
      s.rotation.y = Math.PI / 2 + THREE.MathUtils.randFloatSpread(1.4)
    }
  }

  update(t) {
    const wf = this.waveField
    for (let i = 0; i < this.count; i++) {
      const s = this.surfers[i]
      const { x, z } = s.userData.seat
      const y = wf.heightAt(x, z, t)
      s.position.set(x, y + 0.12 + Math.sin(t * 1.3 + s.userData.phase) * 0.05, z)
      const n = wf.normalAt(x, z, t, 3)
      s.rotation.x = n.z * 0.4
      s.rotation.z = -n.x * 0.4
    }
  }
}
