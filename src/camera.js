// POV rig: sitting on a board just outside the break at the North Curly
// A-frame. The eye rides the same wave field as the ocean mesh, run through
// damped springs (a floating body is a low-pass filter) so swell lifts you
// without the nauseating chop. Rotation stays user-controlled: click-drag
// (or touch-drag) to look around; the sim never yanks yaw, and pitch/roll
// from the water is tiny and heavily smoothed.

import * as THREE from 'three'
import { BANK_PEAK_Z, shorelineX, seaDepth, beachElevation, NORTH_SEAT_LIMIT_Z } from './geo.js'

const EYE_HEIGHT = 0.85 // sitting on a board
// how far down you can look: far enough to see your own lap and board
// (was -0.55, which stopped short of your knees)
const PITCH_MIN = -1.2
// never sit on or near the sand: at least this much still water under you
const SEAT_MIN_DEPTH = 1.5
// if the lineup search ever fails, sit this far out from the shoreline
const SEAT_FALLBACK = 60
// the ground profile is the same everywhere relative to the local shoreline,
// so "1.5 m of water" is a fixed distance seaward of it
const SEAT_MIN_XS = (() => {
  let xs = 0
  while (-beachElevation(xs) < SEAT_MIN_DEPTH) xs += 0.1
  return xs
})()
const minSeatX = (z) => shorelineX(z) + SEAT_MIN_XS

export class POVCamera {
  constructor(waveField, dom) {
    this.waveField = waveField
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 12000)

    this.seatZ = BANK_PEAK_Z
    this.seatX = this._defaultSeat()
    this.eyeHeight = EYE_HEIGHT // debug can lift this for a drone view
    this.userMoved = false
    this._keys = new Set()
    window.addEventListener('keydown', (e) => {
      if (e.key.startsWith('Arrow') || 'wasdWASD'.includes(e.key)) {
        this._keys.add(e.key.toLowerCase())
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => this._keys.delete(e.key.toLowerCase()))

    this.yaw = 0 // 0 = facing the beach (-X)
    this.pitch = -0.02

    // spring state
    this.y = 0
    this.yVel = 0
    this.swayX = 0
    this.swayZ = 0
    this.tiltPitch = 0
    this.tiltRoll = 0

    this._bindPointer(dom)
  }

  // sit in the lineup just OUTSIDE the break: a few metres seaward of where
  // the set waves stop being clean linear swell (waves.js nonlinearOnsetX),
  // so sets pass under you unbroken and detonate shoreward. Only the
  // cross-shore distance comes from the conditions; z stays put. Never in
  // water shallower than a sitting surfer needs, and inside the fine mesh.
  // Skipped once the user has paddled somewhere themselves.
  // (surfers.js seats the crowd on the same line)
  lineupX(z) {
    let x = this.waveField.lineupX(z)
    if (!Number.isFinite(x)) x = shorelineX(z) + SEAT_FALLBACK
    // hard shore clamp (same ground function as the terrain), and stay
    // inside the fine-mesh near tier
    return THREE.MathUtils.clamp(Math.max(x, minSeatX(z)), 6, 470)
  }

  _defaultSeat() {
    return this.lineupX(this.seatZ)
  }

  reseat() {
    if (!this.userMoved) this.seatX = this._defaultSeat()
  }

  // invariant: the seat is in the water, seaward of the shoreline
  _checkSeat() {
    const d = seaDepth(this.seatX, this.seatZ)
    if (d >= SEAT_MIN_DEPTH - 0.05 && this.seatX > shorelineX(this.seatZ) && this.seatZ >= NORTH_SEAT_LIMIT_Z - 0.01) return
    if (!this._warned) {
      console.warn(`[curlysim] seat on/near land: x=${this.seatX.toFixed(1)} z=${this.seatZ.toFixed(1)} depth=${d.toFixed(2)} shoreline=${shorelineX(this.seatZ).toFixed(1)}`)
      this._warned = true
    }
  }

  _move(dt) {
    const k = this._keys
    if (k.size === 0) return
    let fwd = 0
    let str = 0
    if (k.has('arrowup') || k.has('w')) fwd += 1
    if (k.has('arrowdown') || k.has('s')) fwd -= 1
    if (k.has('arrowright') || k.has('d')) str += 1
    if (k.has('arrowleft') || k.has('a')) str -= 1
    if (fwd === 0 && str === 0) return
    const sp = 18 * dt
    // view-relative: forward follows where you're looking
    const lookX = -Math.cos(this.yaw)
    const lookZ = Math.sin(this.yaw)
    this.seatX += (lookX * fwd - lookZ * str) * sp
    this.seatZ += (lookZ * fwd + lookX * str) * sp
    // stay inside the fine-mesh near tier (x -20..500, z -640..120)
    // south of the north headland wall, inside the fine-mesh near tier
    this.seatZ = THREE.MathUtils.clamp(this.seatZ, Math.max(NORTH_SEAT_LIMIT_Z, -610), 90)
    this.seatX = THREE.MathUtils.clamp(Math.max(this.seatX, minSeatX(this.seatZ)), 6, 470)
    this.userMoved = true
  }

  _bindPointer(dom) {
    let dragging = false
    let lastX = 0
    let lastY = 0
    dom.addEventListener('pointerdown', (e) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      dom.classList.add('dragging')
      dom.setPointerCapture(e.pointerId)
    })
    // WoW-style: you grab the world and drag it, view follows the grab —
    // no inertia, no glide after release
    dom.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      this.yaw += dx * 0.0032
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0032, PITCH_MIN, 0.75)
    })
    const end = (e) => {
      dragging = false
      dom.classList.remove('dragging')
    }
    dom.addEventListener('pointerup', end)
    dom.addEventListener('pointercancel', end)
  }

  update(dt, t) {
    dt = Math.min(dt, 0.05)
    this._move(dt)
    this._checkSeat()
    const wf = this.waveField
    const targetY = wf.heightAt(this.seatX, this.seatZ, t)
    // tight low-pass: smooths the chop jitter but never lets the eye lag a
    // passing swell — you stay ~1 m above the surface at all times
    this.y += (targetY - this.y) * Math.min(dt / 0.18, 1)
    this.y = Math.max(this.y, targetY - 0.15)

    // horizontal position stays fixed: only the vertical rides the water
    // gentle deck tilt from the smoothed wave normal, clamped to a few degrees
    const n = wf.normalAt(this.seatX, this.seatZ, t, 3)
    const maxTilt = 0.03
    const targetPitch = THREE.MathUtils.clamp(-n.x * 0.5, -maxTilt, maxTilt)
    const targetRoll = THREE.MathUtils.clamp(n.z * 0.35, -maxTilt, maxTilt)
    this.tiltPitch += (targetPitch - this.tiltPitch) * Math.min(dt * 1.2, 1)
    this.tiltRoll += (targetRoll - this.tiltRoll) * Math.min(dt * 1.2, 1)

    const cam = this.camera
    cam.position.set(this.seatX, this.y + this.eyeHeight, this.seatZ)
    // yaw 0 faces -X (the beach)
    cam.rotation.order = 'YXZ'
    cam.rotation.y = Math.PI / 2 + this.yaw
    cam.rotation.x = this.pitch + this.tiltPitch
    cam.rotation.z = this.tiltRoll
  }
}
