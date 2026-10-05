// Low-poly Curl Curl: procedural heightfield shaped from the real viewshed.
// Looking shoreward from the North Curly lineup: north headland close on the
// right with the rock pool, lagoon mouth and North SLSC ahead, dune/parkland
// middle (unusually green for Sydney), South SLSC + ocean pool + cafe to the
// left under the south headland, Freshwater then North Head far south, and
// Dee Why headland + Long Reef's long low profile on the northern horizon.

import * as THREE from 'three'
import { HEADLANDS, shorelineX, beachElevation, LAGOON_Z, LAGOON_SIGMA, LAGOON_EDGE } from './geo.js'


const gauss = (v, s) => Math.exp(-(v * v) / (2 * s * s))
const smooth = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

// shoreline shift comes from geo.js (shared with the wave physics)
function headlandAt(z) {
  let h = 0
  for (const hd of HEADLANDS) h = Math.max(h, hd.h * gauss(z - hd.z, hd.sz))
  return { shift: shorelineX(z), h }
}

// Ground height. The cross-shore profile — sea floor, waterline, beach face —
// is geo.js beachElevation, the same function the waves get their depth from.
// Dunes, hills, headland cliffs and the lagoon are added only inland of the
// waterline (each is exactly 0 there), so they can't move the shoreline.
export function terrainHeight(x, z) {
  const { shift, h: headH } = headlandAt(z)
  const xs = x - shift
  const base = beachElevation(xs)
  if (xs >= 0) return base // sea floor

  const inland = -xs
  const headNorm = Math.min(headH / 40, 1)
  const lagoon = gauss(z - LAGOON_Z, LAGOON_SIGMA)

  // beach face from the shared profile, then the dune ridge further back
  let y = base
  y += 6 * gauss(inland - 58, 20) * smooth(0, 20, inland) * (1 - headNorm) * (1 - 0.9 * lagoon) // dune ridge
  // hills behind (John Fisher Park stays flat, houses on the rise)
  const hillNoise = 0.8 + 0.2 * Math.sin(z * 0.005 + 1) + 0.12 * Math.sin(z * 0.013)
  y += Math.min(Math.max(inland - 130, 0) * 0.06, 58) * hillNoise * (1 - 0.92 * lagoon)
  // headland mass: steep cliff face at the sea edge
  y += headH * smooth(0, 35, inland)
  // lagoon flat
  if (lagoon > LAGOON_EDGE && inland > 15) y = Math.min(y, Math.max(0.6 + (1 - lagoon) * 4, base))
  return y
}

const COL = {
  sand: new THREE.Color(0xe6d7ae),
  sandWet: new THREE.Color(0xd8c9a3),
  scrub: new THREE.Color(0x8fa671),
  grass: new THREE.Color(0x75b06b),
  hills: new THREE.Color(0x6e9663),
  rock: new THREE.Color(0x8d7f6d),
  rockLight: new THREE.Color(0xa3937c),
}

function faceColor(x, z, y) {
  if (y < -0.2) return COL.sandWet
  const { shift, h: headH } = headlandAt(z)
  const inland = shift - x
  // local slope
  const e = 6
  const g = Math.hypot(
    terrainHeight(x + e, z) - terrainHeight(x - e, z),
    terrainHeight(x, z + e) - terrainHeight(x, z - e)
  ) / (2 * e)
  if (g > 0.42 || (headH > 12 && inland < 55)) {
    return Math.sin(x * 0.11 + z * 0.07) > 0.2 ? COL.rockLight : COL.rock
  }
  if (inland < 26 || y < 1.6) return COL.sand
  if (inland < 120) return Math.sin(z * 0.045 + x * 0.03) > 0.35 ? COL.grass : COL.scrub
  if (y < 5) return COL.grass
  return COL.hills
}

function buildPatch(x0, x1, z0, z1, nx, nz, yOffset = 0) {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz)
  geo.rotateX(-Math.PI / 2)
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)) + yOffset)
  }
  const flat = geo.toNonIndexed()
  flat.deleteAttribute('uv') // untextured: uv would only cost memory
  flat.computeVertexNormals()
  // crisp per-facet colors from the triangle centroid
  const p = flat.attributes.position
  const colors = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3
    const c = faceColor(cx, cz, cy)
    for (let j = 0; j < 3; j++) {
      colors[(i + j) * 3] = c.r
      colors[(i + j) * 3 + 1] = c.g
      colors[(i + j) * 3 + 2] = c.b
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  return new THREE.Mesh(flat, mat)
}

function makeBuilding(w, h, d, wall, roof) {
  const g = new THREE.Group()
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: wall, roughness: 1 })
  )
  walls.position.y = h / 2
  const roofM = new THREE.Mesh(
    new THREE.BoxGeometry(w * 1.12, h * 0.18, d * 1.12),
    new THREE.MeshStandardMaterial({ color: roof, roughness: 1 })
  )
  roofM.position.y = h * 1.05
  g.add(walls, roofM)
  return g
}

function makePool(w, d) {
  const g = new THREE.Group()
  const rim = new THREE.MeshStandardMaterial({ color: 0xf0efe6, roughness: 1 })
  const wall = 1.2
  const mk = (bw, bd, px, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 1.6, bd), rim)
    m.position.set(px, 0.8, pz)
    g.add(m)
  }
  mk(w, wall, 0, -d / 2)
  mk(w, wall, 0, d / 2)
  mk(wall, d, -w / 2, 0)
  mk(wall, d, w / 2, 0)
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w - wall, d - wall),
    new THREE.MeshStandardMaterial({ color: 0x66c2c8, roughness: 0.4 })
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = 1.1
  g.add(water)
  return g
}

export function buildTerrain(scene) {
  const near = buildPatch(-420, 160, -880, 920, 200, 600)
  const far = buildPatch(-1600, 950, -3600, 3600, 140, 300, -0.4)
  scene.add(near, far)

  // clubhouses + cafe
  // North Curly SLSC sits practically on the sand
  // surf clubs: two-storey, ~8 m to the roof and ~25 m long, like the real North/South Curl Curl SLSCs
  const northSLSC = makeBuilding(26, 8, 12, 0xf2ead8, 0xb0543f)
  northSLSC.position.set(-11, terrainHeight(-11, -430), -430)
  const southSLSC = makeBuilding(24, 8, 12, 0xe8e2d2, 0x7a6f5f)
  southSLSC.position.set(-26, terrainHeight(-26, 480), 480)
  const cafe = makeBuilding(8, 3.4, 6, 0xdcd6c4, 0x4f5a63)
  cafe.position.set(-22, terrainHeight(-22, 528), 528)
  scene.add(northSLSC, southSLSC, cafe)

  // ocean pools: 50m lap pool under the south headland, rock pool north
  const southPool = makePool(50, 18)
  southPool.position.set(52, 0, 598)
  const northPool = makePool(28, 14)
  northPool.position.set(66, 0, -622)
  scene.add(southPool, northPool)

  // lagoon water behind the beach
  const lagoonWater = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 240),
    new THREE.MeshStandardMaterial({ color: 0x5fa8a8, roughness: 0.5 })
  )
  lagoonWater.rotation.x = -Math.PI / 2
  lagoonWater.position.set(-150, 0.45, LAGOON_Z)
  scene.add(lagoonWater)

  // houses scattered on the hills behind
  const houseGeo = new THREE.BoxGeometry(1, 1, 1)
  const houseMat = new THREE.MeshStandardMaterial({ roughness: 1 })
  const houses = new THREE.InstancedMesh(houseGeo, houseMat, 90)
  const palette = [0xe7e3da, 0xd9cfc0, 0xcdd6d8, 0xe3d3c2, 0xbfc8bb, 0xd8dde2]
  const mtx = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  let count = 0
  let guard = 0
  while (count < 90 && guard++ < 2000) {
    const z = THREE.MathUtils.randFloatSpread(1700) - 100
    const { shift } = headlandAt(z)
    const inland = 150 + Math.random() * 280
    const x = shift - inland
    const y = terrainHeight(x, z)
    if (y < 7 || y > 60) continue
    if (Math.abs(z - LAGOON_Z) < 130) continue
    const w = 6 + Math.random() * 6
    const h = 3.5 + Math.random() * 3
    q.setFromAxisAngle(up, Math.random() * 0.4 - 0.2)
    mtx.compose(new THREE.Vector3(x, y + h / 2 - 0.3, z), q, new THREE.Vector3(w, h, w * 0.9))
    houses.setMatrixAt(count, mtx)
    houses.setColorAt(count, new THREE.Color(palette[count % palette.length]))
    count++
  }
  houses.count = count
  scene.add(houses)

  // (pines live in trees.js now — they sway with the wind)
}
