// Your own body: legs and a surfboard under the POV camera, at true
// real-world scale, so a set can be judged against something you know the
// size of. Posture is sitting astride the board (the camera's 0.85 m eye
// height is a seated surfer): thighs along the deck gripping the rails,
// shins hanging into the water. Low-poly to match the crowd in surfers.js,
// which reuses the same legs and board.
//
// The rig rides the same smoothed water height as the camera and turns like a
// seated surfer: your head can look ~55° either way before the board swings
// round under you, and paddling (WASD/arrows) brings it straight to your view.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { makeBoard } from './board.js'

// --- tuning (metres / radians) -------------------------------------------
// Rig origin = the water point directly under the eye; forward = -Z.
// Seat = where the hips sit on the deck (board origin).
export const BODY = {
  deckY: 0.1, // deck above the (smoothed) water at the seat: a touch of
  // freeboard over reality (a sat-on shortboard is mostly awash) so the deck
  // stays readable as a size reference
  hipBack: 0.08, // hips sit a little behind the eye
  hipUp: 0.09, // hip joint above the deck (thigh radius + a bit)
  hipHalf: 0.11, // half the distance between hip joints
  thigh: 0.44, // hip -> knee
  shin: 0.4, // knee -> ankle
  foot: 0.07, // ankle -> sole   (hip-to-sole = 0.91)
  kneeHalf: 0.3, // knees out over the rails
  thighR: 0.075,
  shinR: 0.05,
  headSlack: 0.95, // rad the view can turn before the board follows
}

const WETSUIT = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 1, flatShading: true })
const SKIN = new THREE.MeshStandardMaterial({ color: 0xd9a878, roughness: 1, flatShading: true })

const UP = new THREE.Vector3(0, 1, 0)
const _n = { x: 0, y: 1, z: 0 } // scratch normal

function limb(a, b, r) {
  const d = new THREE.Vector3().subVectors(b, a)
  const len = d.length()
  const g = new THREE.CapsuleGeometry(r, Math.max(len - r, 0.01), 2, 7)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)))
}

// Seated-astride legs + lap, in the seat frame (origin on the deck at the
// seat, forward -Z), as separate wetsuit and skin parts already placed.
export function legParts() {
  const B = BODY
  const wetsuit = []
  const skin = []
  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * B.hipHalf, B.hipUp, 0)
    // thigh runs forward along the deck, splayed out to grip the rail
    const dx = B.kneeHalf - B.hipHalf
    const dy = -0.02
    const dz = Math.sqrt(B.thigh ** 2 - dx * dx - dy * dy)
    const knee = new THREE.Vector3(side * B.kneeHalf, hip.y + dy, hip.z - dz)
    // shin hangs down into the water, feet slightly forward and out
    const sdx = 0.03
    const sdz = 0.12
    const sdy = Math.sqrt(B.shin ** 2 - sdx * sdx - sdz * sdz)
    const ankle = new THREE.Vector3(side * (B.kneeHalf + sdx), knee.y - sdy, knee.z - sdz)
    wetsuit.push(limb(hip, knee, B.thighR), limb(knee, ankle, B.shinR))
    const foot = new THREE.BoxGeometry(0.095, B.foot, 0.25)
    foot.rotateX(-0.5) // toes pointed, dangling
    foot.translate(ankle.x, ankle.y - B.foot / 2, ankle.z - 0.07)
    skin.push(foot)
  }
  // pelvis / lap joining the thighs (seen when looking straight down)
  const pelvis = new THREE.BoxGeometry(2 * B.hipHalf + 0.13, 0.16, 0.24)
  pelvis.translate(0, B.hipUp + 0.01, 0.06)
  wetsuit.push(pelvis)
  return { wetsuit, skin }
}

// one geometry per material: a whole body is 2 draw calls, not 7+
export function mergeParts(list) {
  if (list.some((g) => g.index === null)) list = list.map((g) => (g.index === null ? g : g.toNonIndexed()))
  return mergeGeometries(list)
}

// Built once; every caller shares the two merged geometries.
let legGeo = null
export function makeLegs() {
  if (!legGeo) {
    const { wetsuit, skin } = legParts()
    legGeo = { wetsuit: mergeParts(wetsuit), skin: mergeParts(skin) }
  }
  const g = new THREE.Group()
  g.add(new THREE.Mesh(legGeo.wetsuit, WETSUIT), new THREE.Mesh(legGeo.skin, SKIN))
  return g
}
export const MATERIALS = { WETSUIT, SKIN }

export class Body {
  constructor(scene, pov) {
    this.pov = pov
    this.rig = new THREE.Group() // position + water tilt (world frame)
    this.yawGroup = new THREE.Group() // heading of the board
    this.rig.add(this.yawGroup)
    const seat = new THREE.Group()
    seat.position.set(0, BODY.deckY, BODY.hipBack)
    seat.add(makeBoard(0xf2f0e8), makeLegs())
    this.yawGroup.add(seat)
    scene.add(this.rig)
    this.bodyYaw = pov.yaw
    this.tiltX = 0
    this.tiltZ = 0
  }

  update(dt, t) {
    dt = Math.min(dt, 0.05)
    const pov = this.pov
    // a drone-height debug eye has no body under it
    this.rig.visible = pov.eyeHeight < 1.5
    if (!this.rig.visible) return

    // board heading: free head-look inside the slack, then the board swings
    // round; paddling points it straight where you're looking
    let d = pov.yaw - this.bodyYaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    const paddling = pov._keys.size > 0
    const slack = paddling ? 0 : BODY.headSlack
    const excess = Math.sign(d) * Math.max(Math.abs(d) - slack, 0)
    this.bodyYaw += excess * Math.min(dt * (paddling ? 4 : 3), 1)

    // the board follows the water slope more than the (stabilised) head does
    const n = pov.waveField.normalAt(pov.seatX, pov.seatZ, t, 2, _n)
    const max = 0.12
    const tz = THREE.MathUtils.clamp(-n.x * 0.8, -max, max)
    const tx = THREE.MathUtils.clamp(n.z * 0.8, -max, max)
    this.tiltZ += (tz - this.tiltZ) * Math.min(dt * 2, 1)
    this.tiltX += (tx - this.tiltX) * Math.min(dt * 2, 1)

    this.rig.position.set(pov.seatX, pov.y, pov.seatZ)
    this.rig.rotation.set(this.tiltX, 0, this.tiltZ)
    this.yawGroup.rotation.y = Math.PI / 2 + this.bodyYaw
  }
}
