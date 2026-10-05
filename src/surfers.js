// The crowd. Count comes from a quality x human-factors model:
// wave quality (face size sweet spot, period, wind) times time-of-day /
// day-of-week / daylight factors. Placement follows real Curl Curl habit:
// spread across the mid-beach peaks on clean days, huddled in the
// semi-sheltered north corner when the NE'er is on, empty when it's junk.

import * as THREE from 'three'
import { BANK_PEAK_Z, BANK_WAVELENGTH, fromDirToVec, NORTH_SEAT_LIMIT_Z, shorelineX } from './geo.js'
import { makeBoard } from './board.js'
import { legParts, mergeParts, BODY, MATERIALS } from './body.js'

const MAX_SURFERS = 20 // busiest it gets (was 14)
const MIN_SURFERS = 1 // always someone out: a body + board for scale
const MIN_GAP = 4.6 // m: nobody ever sits closer than ~5 yards to the viewer
const BUDDY_R = [7, 16] // m: the nearest surfer is placed this far from you
const NEARBY_R = 25 // m: if nobody is this close, the buddy re-seats near you
const SURFER_GAP = 3 // m between other surfers' seats
// everyone sits in the viewer's lineup band: within this many metres (~5 yd)
// cross-shore of the lineup line, spread up and down the beach in packs
export const LINEUP_BAND = 4.6
const PACK_SPREAD = 35 // m: a pack spreads this far either side of its peak

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
  return { count: THREE.MathUtils.clamp(count, MIN_SURFERS, MAX_SURFERS), quality }
}

const _n = { x: 0, y: 1, z: 0 } // scratch normal
const BOARD_COLORS = [0xf2f0e8, 0xe8b84b, 0x7fc4d8, 0xd87f6a, 0x9fd88f]
// Same board and legs as the viewer (board.js / body.js), so every board in
// the lineup is the same true-size measuring stick. Origin = seat on the deck.
// Legs + torso share one wetsuit geometry and feet + head one skin geometry,
// so a surfer is 4 draw calls (hull, stringer, wetsuit, skin).
let crowdGeo = null
function crowdGeometry() {
  if (crowdGeo) return crowdGeo
  const { wetsuit, skin } = legParts()
  const torso = new THREE.BoxGeometry(0.3, 0.58, 0.26)
  torso.translate(0, 0.34, 0.04)
  const head = new THREE.IcosahedronGeometry(0.12, 0)
  head.translate(0, 0.8, 0.02) // eye ~0.8 m above the deck, like ours
  crowdGeo = { wetsuit: mergeParts([...wetsuit, torso]), skin: mergeParts([...skin, head]) }
  return crowdGeo
}

function makeSurfer() {
  const g = new THREE.Group() // position + water tilt
  const yaw = new THREE.Group() // heading
  const geo = crowdGeometry()
  yaw.add(
    makeBoard(BOARD_COLORS[(Math.random() * BOARD_COLORS.length) | 0]),
    new THREE.Mesh(geo.wetsuit, MATERIALS.WETSUIT),
    new THREE.Mesh(geo.skin, MATERIALS.SKIN)
  )
  g.add(yaw)
  g.userData.yaw = yaw
  return g
}

export class Surfers {
  constructor(scene, waveField, pov) {
    this.waveField = waveField
    this.pov = pov
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
    this._lonely = 0
  }

  // Where a surfer actually is this frame: their home seat, unless you've
  // paddled within MIN_GAP of it, in which case they sit pushed radially out
  // to MIN_GAP. Computed fresh from the home seat every frame, so nobody gets
  // shoved along (and bunched up) as you paddle past; they settle back home.
  _clear(home, out) {
    const dx = home.x - this.pov.seatX
    const dz = home.z - this.pov.seatZ
    const r = Math.hypot(dx, dz)
    if (r >= MIN_GAP) {
      out.x = home.x
      out.z = home.z
      return out
    }
    const ux = r > 1e-3 ? dx / r : 0
    const uz = r > 1e-3 ? dz / r : 1
    out.x = this.pov.seatX + ux * MIN_GAP
    out.z = this.pov.seatZ + uz * MIN_GAP
    // never shoved past the north wall: go round the other side instead
    if (out.z < NORTH_SEAT_LIMIT_Z) out.z = this.pov.seatZ + Math.abs(uz) * MIN_GAP
    return out
  }

  // the viewer's lineup distance from the shore, applied at this z (the
  // coast curves toward the north headland, so band x follows the shoreline)
  _bandX(z, lineFromShore = this._lineFromShore()) {
    const x = shorelineX(z) + lineFromShore + THREE.MathUtils.randFloatSpread(2 * LINEUP_BAND)
    return Math.min(x, 470)
  }

  // (runs the lineup search, so callers placing many surfers pass it in)
  _lineFromShore() {
    const vz = this.pov.seatZ
    return this.pov.lineupX(vz) - shorelineX(vz)
  }

  // put the buddy (surfer 0) BUDDY_R up or down the beach from the viewer, in
  // the band; `side` (+1/-1 along z) picks which way, random by default
  _seatBuddy(side = Math.random() < 0.5 ? -1 : 1, line = this._lineFromShore()) {
    const s = this.surfers[0]
    let z = this.pov.seatZ + side * THREE.MathUtils.randFloat(BUDDY_R[0], BUDDY_R[1])
    if (z < NORTH_SEAT_LIMIT_Z) z = this.pov.seatZ + Math.abs(z - this.pov.seatZ) // no room north: go south
    s.userData.home = { x: this._bandX(z, line), z }
    s.userData.yaw.rotation.y = this._heading()
  }

  // most sit facing out to sea watching for sets; some face the beach
  _heading() {
    const base = Math.random() < 0.75 ? -Math.PI / 2 : Math.PI / 2
    return base + THREE.MathUtils.randFloatSpread(1.4)
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

    for (let i = 0; i < MAX_SURFERS; i++) this.surfers[i].visible = i < count
    const line = this._lineFromShore()
    this._seatBuddy(undefined, line)
    const placed = [this.surfers[0].userData.home]
    const vz = this.pov.seatZ
    for (let i = 1; i < count; i++) {
      const s = this.surfers[i]
      let z
      for (let tries = 0; tries < 12; tries++) {
        if (northCorner) {
          // tucked in just south of the north headland wall
          z = NORTH_SEAT_LIMIT_Z + Math.random() * 110
        } else {
          // packs on three peaks: ours, one south, and one north (pulled in
          // so its whole spread stays south of the north headland wall)
          const r = Math.random()
          const north = Math.max(BANK_PEAK_Z - BANK_WAVELENGTH, NORTH_SEAT_LIMIT_Z + PACK_SPREAD)
          const peak = r < 0.4 ? BANK_PEAK_Z : r < 0.7 ? north : BANK_PEAK_Z + BANK_WAVELENGTH
          z = peak + THREE.MathUtils.randFloatSpread(2 * PACK_SPREAD)
        }
        // only the buddy sits in the close ring: everyone else is further
        // along the beach (pushed to the nearer side if a draw lands close)
        if (Math.abs(z - vz) < BUDDY_R[1]) z = vz + (z >= vz ? 1 : -1) * (BUDDY_R[1] + Math.random() * 4)
        z = Math.max(z, NORTH_SEAT_LIMIT_Z)
        if (placed.every((p) => Math.abs(p.z - z) > SURFER_GAP)) break
      }
      // the same band as the viewer: just outside the break at this z
      const home = { x: this._bandX(z, line), z }
      placed.push(home)
      s.userData.home = home
      s.userData.seat = { ...home }
      s.userData.yaw.rotation.y = this._heading()
    }
    this.surfers[0].userData.seat = { ...this.surfers[0].userData.home }
  }

  update(t, dt = 0.016) {
    const wf = this.waveField
    let nearest = Infinity
    for (let i = 0; i < this.count; i++) {
      const { home, seat } = this.surfers[i].userData
      this._clear(home, seat) // continuous: you can paddle, they make room
      nearest = Math.min(nearest, Math.hypot(seat.x - this.pov.seatX, seat.z - this.pov.seatZ))
    }
    // someone nearby most of the time: if you've paddled away from everyone,
    // the buddy quietly re-seats near you on the side you're not looking at
    this._lonely = nearest > NEARBY_R ? this._lonely + Math.min(dt, 0.1) : 0
    if (this._lonely > 4) {
      const lookZ = Math.sin(this.pov.yaw) // yaw 0 faces -X; +z component of view
      this._seatBuddy(lookZ > 0 ? -1 : 1)
      this.surfers[0].userData.seat = { ...this.surfers[0].userData.home }
      this._lonely = 0
    }
    for (let i = 0; i < this.count; i++) {
      const s = this.surfers[i]
      const { x, z } = s.userData.seat
      const y = wf.heightAt(x, z, t)
      s.position.set(x, y + BODY.deckY + Math.sin(t * 1.3 + s.userData.phase) * 0.03, z)
      const n = wf.normalAt(x, z, t, 2, _n)
      s.rotation.set(THREE.MathUtils.clamp(n.z * 0.8, -0.2, 0.2), 0, THREE.MathUtils.clamp(-n.x * 0.8, -0.2, 0.2))
    }
  }
}
