// POV rig: sitting on a board just outside the break at the North Curly
// A-frame. The eye rides the same wave field as the ocean mesh, run through
// damped springs (a floating body is a low-pass filter) so swell lifts you
// without the nauseating chop. Rotation stays user-controlled: click-drag
// (or touch-drag) to look around; the sim never yanks yaw, and pitch/roll
// from the water is tiny and heavily smoothed.

import * as THREE from 'three'
import { BANK_PEAK_Z } from './geo.js'

const EYE_HEIGHT = 0.85 // sitting on a board

export class POVCamera {
  constructor(waveField, dom) {
    this.waveField = waveField
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 12000)

    this.seatZ = BANK_PEAK_Z
    this.seatX = waveField.xBreak + 42
    this.eyeHeight = EYE_HEIGHT // debug can lift this for a drone view

    this.yaw = 0 // 0 = facing the beach (-X)
    this.pitch = -0.02
    this.yawVel = 0
    this.pitchVel = 0

    // spring state
    this.y = 0
    this.yVel = 0
    this.swayX = 0
    this.swayZ = 0
    this.tiltPitch = 0
    this.tiltRoll = 0

    this._bindPointer(dom)
  }

  // keep the seat just outside wherever today's break line is
  reseat() {
    this.seatX = this.waveField.xBreak + 42
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
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0032, -0.55, 0.75)
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
    const wf = this.waveField
    const targetY = wf.heightAt(this.seatX, this.seatZ, t)
    // tight low-pass: smooths the chop jitter but never lets the eye lag a
    // passing swell — you stay ~1 m above the surface at all times
    this.y += (targetY - this.y) * Math.min(dt / 0.18, 1)
    this.y = Math.max(this.y, targetY - 0.15)

    // slow horizontal sway from the orbital motion
    const s = wf._surface(this.seatX, this.seatZ, t)
    this.swayX += (s.dx * 0.45 - this.swayX) * Math.min(dt * 1.6, 1)
    this.swayZ += (s.dz * 0.45 - this.swayZ) * Math.min(dt * 1.6, 1)

    // gentle deck tilt from the smoothed wave normal, clamped to a few degrees
    const n = wf.normalAt(this.seatX, this.seatZ, t, 3)
    const maxTilt = 0.06
    const targetPitch = THREE.MathUtils.clamp(-n.x * 0.5, -maxTilt, maxTilt)
    const targetRoll = THREE.MathUtils.clamp(n.z * 0.35, -maxTilt, maxTilt)
    this.tiltPitch += (targetPitch - this.tiltPitch) * Math.min(dt * 1.2, 1)
    this.tiltRoll += (targetRoll - this.tiltRoll) * Math.min(dt * 1.2, 1)

    const cam = this.camera
    cam.position.set(this.seatX + this.swayX, this.y + this.eyeHeight, this.seatZ + this.swayZ)
    // yaw 0 faces -X (the beach)
    cam.rotation.order = 'YXZ'
    cam.rotation.y = Math.PI / 2 + this.yaw
    cam.rotation.x = this.pitch + this.tiltPitch
    cam.rotation.z = this.tiltRoll
  }
}
