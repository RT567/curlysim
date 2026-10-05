// Shared geography + coordinate conventions for the whole sim.
//
// World space (three.js, Y up):
//   +X = offshore, pointing out to sea along the beach normal (compass 115°, ESE)
//   -X = toward the sand
//   +Z = along the beach toward the SOUTH end (compass 205°, Freshwater side)
//   -Z = along the beach toward the NORTH end (Long Reef side)
//   Shoreline is roughly the line x = 0 (headlands push it seaward locally).
//
// Compass headings are degrees clockwise from north. Met/marine data reports
// directions as "coming FROM"; propagation heading is FROM + 180.

export const LAT = -33.768
export const LON = 151.297
export const BEACH_FACING = 115 // compass bearing of the beach normal (ESE)

export const BREAKER_INDEX = 0.78 // waves break when H > 0.78 * depth

// Along-beach sandbank structure: amplitude peaks (A-frames) every BANK_WAVELENGTH
// metres, with one peak pinned at BANK_PEAK_Z — the North Curly A-frame we sit on.
export const BANK_PEAK_Z = -300
export const BANK_WAVELENGTH = 224
export const BANK_K = (2 * Math.PI) / BANK_WAVELENGTH

const DEG = Math.PI / 180

// Unit vector (x, z) for travel along a compass heading.
export function headingToVec(headingDeg) {
  const a = (headingDeg - BEACH_FACING) * DEG
  return { x: Math.cos(a), z: Math.sin(a) }
}

// Unit vector for something reported as "coming from" a compass direction.
export function fromDirToVec(fromDeg) {
  return headingToVec(fromDeg + 180)
}

// --- the ground: ONE elevation function for sea floor, beach and dunes ----
//
// The coast is a bay: headlands at the ends push the still-water shoreline
// seaward (shorelineX). Everything cross-shore is measured from that local
// shoreline, xs = x - shorelineX(z) (+ = seaward), and the ground elevation
// is the single function beachElevation(xs), the same at every z:
//   xs >= 0  (sea floor):  -(DEAN_A (xs + X0)^(2/3) - DEAN_A X0^(2/3))   (Dean profile, see DEAN_A)
//   xs <  0  (beach face): BERM_H * (1 - exp(FACE_SLOPE*xs / BERM_H))
// Smooth (C1) through the waterline (slope FACE_SLOPE both sides), monotonic, 0 exactly at the shoreline.
// Users: waves.js depthAt + its GLSL twin (wave physics, onset/lineup search),
// terrain.js terrainHeight (visible beach + sea floor; dunes, hills and
// headland cliffs are added on top only inland of the waterline).
export const HEADLANDS = [
  { z: 650, h: 42, sz: 200, sea: 120 }, // South Curl Curl headland
  { z: -680, h: 55, sz: 190, sea: 160 }, // North Curl Curl headland
  { z: -1450, h: 40, sz: 240, sea: 110 }, // Dee Why headland
  { z: -2700, h: 26, sz: 420, sea: 800 }, // Long Reef: long, low, juts seaward
  { z: 1450, h: 46, sz: 260, sea: 140 }, // Freshwater / Queenscliff
  { z: 2900, h: 75, sz: 420, sea: 320 }, // Manly North Head
]
// Curl Curl lagoon: terrain.js flattens the land to a lagoon flat wherever
// gauss(z - LAGOON_Z, LAGOON_SIGMA) > LAGOON_EDGE. Its north edge is where the
// North Curl Curl headland plateau rises as a sheer wall: the north end of
// the surfable beach.
export const LAGOON_Z = -350
export const LAGOON_SIGMA = 110
export const LAGOON_EDGE = 0.3
export const NORTH_WALL_Z = LAGOON_Z - LAGOON_SIGMA * Math.sqrt(2 * Math.log(1 / LAGOON_EDGE)) // ~ -521
// nobody (viewer or crowd) sits further north than this: 115 m south of the wall (Rob, 2026-10-05: 15 m,
// then 65 m, still put people visibly too far north)
export const NORTH_SEAT_LIMIT_Z = NORTH_WALL_Z + 115
// ...and nobody further south than where the South Curl Curl headland (HEADLANDS[0]) starts pushing the
// shoreline out to its rocks (~z 300): the far end of the surfable beach
export const SOUTH_SEAT_LIMIT_Z = HEADLANDS[0].z - 1.75 * HEADLANDS[0].sz

// Sea floor: Dean's equilibrium profile h = A x^(2/3) for the northern beaches' medium sand (d50 ~0.35 mm,
// fall speed ~4.6 cm/s -> A = 0.067 ws^0.44 = 0.13 m^(1/3); Dean 1987), shifted by DEAN_X0 so its slope
// at the waterline is a 1:10 beach face instead of infinite. Depth 1.7 m at 50 m, 2.7 at 100, 4.4 at 200,
// 7.0 at 400, 11.2 at 800 m out.
export const DEAN_A = 0.13
export const FACE_SLOPE = 1 / 10
const DEAN_X0 = Math.pow(((2 / 3) * DEAN_A) / FACE_SLOPE, 3) // where the Dean slope equals FACE_SLOPE
const DEAN_H0 = DEAN_A * Math.pow(DEAN_X0, 2 / 3)
export const BERM_H = 1.8 // m: beach face levels off at this height

// still-water shoreline x at this z (headlands push it seaward)
export function shorelineX(z) {
  let shift = 0
  for (const hd of HEADLANDS) {
    // sea * gauss^0.7, folded into one exp (as in the GLSL twin): this runs
    // several times per surface sample, for every surfer, every frame
    const dz = z - hd.z
    shift = Math.max(shift, hd.sea * Math.exp((-0.7 * dz * dz) / (2 * hd.sz * hd.sz)))
  }
  return shift
}

// ground elevation (m, 0 = still water) at xs metres seaward of the shoreline
export function beachElevation(xs) {
  if (xs >= 0) return -(DEAN_A * Math.pow(xs + DEAN_X0, 2 / 3) - DEAN_H0)
  return BERM_H * (1 - Math.exp((FACE_SLOPE * xs) / BERM_H))
}

// still-water depth (>= 0) at a world point
export function seaDepth(x, z) {
  return Math.max(-beachElevation(x - shorelineX(z)), 0)
}

// GLSL twin of shorelineX / seaDepth (generated from the same constants)
export const SEABED_GLSL = /* glsl */ `
  float shorelineX(float z) {
    float shift = 0.0;
    ${HEADLANDS.map(
      // m^0.7 = exp(-0.7 dz^2 / 2sz^2)
      (hd) => `{ float d = z - (${hd.z.toFixed(1)}); shift = max(shift, ${hd.sea.toFixed(1)} * exp(-0.7 * d * d / ${(2 * hd.sz * hd.sz).toFixed(1)})); }`
    ).join('\n    ')}
    return shift;
  }
  float seaDepth(vec2 p) {
    float xs = max(p.x - shorelineX(p.y), 0.0);
    return ${DEAN_A.toFixed(6)} * pow(xs + ${DEAN_X0.toFixed(6)}, 0.6666667) - ${DEAN_H0.toFixed(6)};
  }
`

export function knotsToMs(kn) {
  return kn * 0.514444
}
