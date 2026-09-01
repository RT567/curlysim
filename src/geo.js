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

export const SEABED_SLOPE = 0.02 // surf-zone slope: depth = SEABED_SLOPE * x
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

export function depthAt(x) {
  return Math.max(SEABED_SLOPE * x, 0)
}

export function knotsToMs(kn) {
  return kn * 0.514444
}
