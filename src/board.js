// The one surfboard everyone rides. Board size is the sim's measuring stick:
// people know roughly how big a 6'6" is, so the viewer's own board and every
// board in the lineup share these dimensions (world units are metres, the
// same units the wave field uses).

import * as THREE from 'three'

export const BOARD = {
  length: 1.98, // 6'6"
  width: 0.52, // ~20.5"
  thick: 0.065, // ~2.6"
  seatFromTail: 0.74, // where a sitting surfer's hips are, from the tail
  noseUp: 0.06, // rad: sitting weight sinks the tail, the nose lifts
}

// half-width along the board, u = 0 tail .. 1 nose (fraction of max half-width)
const OUTLINE = [
  [0, 0.48], [0.08, 0.68], [0.25, 0.9], [0.45, 1], [0.65, 0.94],
  [0.82, 0.72], [0.93, 0.44], [0.98, 0.2], [1, 0],
]

// Local frame: origin on the deck at the seat, nose toward -Z, deck up +Y.
// Flat (no rocker): the extruded caps are big fan triangles, so bending the
// vertices would warp the deck; the whole-board noseUp pitch reads fine.
function buildHull() {
  const { length: L, width: W, thick: T, seatFromTail } = BOARD
  const bevel = 0.014
  const hw = W / 2 - bevel
  const rail = new THREE.SplineCurve(OUTLINE.map(([u, f]) => new THREE.Vector2(hw * f, u * L - seatFromTail)))
  const right = rail.getPoints(40)
  const pts = [new THREE.Vector2(0, -seatFromTail), ...right]
  for (let i = right.length - 2; i >= 0; i--) pts.push(new THREE.Vector2(-right[i].x, right[i].y))
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth: T - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  })
  geo.rotateX(-Math.PI / 2) // shape y -> -Z (nose forward), extrusion -> +Y
  geo.computeBoundingBox()
  geo.translate(0, -geo.boundingBox.max.y, 0) // deck top at y = 0
  return geo
}

// thin ribbon down the deck centreline
function buildStringer() {
  const { length: L, seatFromTail } = BOARD
  const n = 24
  const v = []
  const idx = []
  for (let i = 0; i <= n; i++) {
    const u = 0.01 + (0.97 * i) / n
    const z = -(u * L - seatFromTail)
    const y = 0.002
    v.push(-0.003, y, z, 0.003, y, z)
    if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

let hull = null
let stringer = null
const STRINGER_MAT = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 })
const mats = new Map()

// A board pitched nose-up about the seat, as it sits under a seated surfer.
export function makeBoard(color = 0xf2f0e8) {
  hull ??= buildHull()
  stringer ??= buildStringer()
  if (!mats.has(color)) mats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true }))
  const g = new THREE.Group()
  g.add(new THREE.Mesh(hull, mats.get(color)), new THREE.Mesh(stringer, STRINGER_MAT))
  g.rotation.x = BOARD.noseUp
  return g
}
