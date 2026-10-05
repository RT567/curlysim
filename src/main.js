// curlysim — POV of sitting out the back at North Curl Curl in the current
// real conditions. No HUD: just drag to look around and wait for a set.

import * as THREE from 'three'
import { WaveField } from './waves.js'
import { Ocean } from './ocean.js'
import { buildTerrain } from './terrain.js'
import { Trees } from './trees.js'
import { SkySystem } from './sky.js'
import { Weather } from './weather.js'
import { Surfers } from './surfers.js'
import { POVCamera } from './camera.js'
import { Body } from './body.js'
import { fetchConditions, DEFAULT_CONDITIONS } from './conditions.js'
import { QUALITY, AdaptiveQuality } from './quality.js'

const app = document.getElementById('app')

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(QUALITY.pixelRatio) // capped lower on phones (quality.js)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.55
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()

const state = {
  conditions: DEFAULT_CONDITIONS,
  timeOffsetHours: 0, // debug only
  overrides: null, // debug only
}
// dev overrides persist across reloads (cleared with curlysim.clearDev()), but only apply with ?debug:
// a plain visit always shows the live conditions
try {
  const dev = new URLSearchParams(location.search).has('debug') && JSON.parse(localStorage.getItem('curlysim-dev') || 'null')
  if (dev) state.overrides = dev
} catch {}

const waveField = new WaveField()
waveField.rebuild(state.conditions)

const ocean = new Ocean(scene, waveField)
buildTerrain(scene)
const trees = new Trees(scene)
const sky = new SkySystem(scene)
const weather = new Weather(scene)
const pov = new POVCamera(waveField, app)
const body = new Body(scene, pov) // your own legs + board under the camera
const surfers = new Surfers(scene, waveField, pov)

function simDate() {
  return new Date(Date.now() + state.timeOffsetHours * 3600 * 1000)
}

function applyConditions(cond) {
  state.conditions = cond
  waveField.rebuild(cond)
  ocean.syncWaves()
  pov.reseat()
  weather.setConditions(cond)
  trees.setConditions(cond)
  const sunAlt = sky.env.sunAltitudeDeg
  surfers.populate(cond, waveField.faceHeight, simDate(), sunAlt)
}

applyConditions(state.overrides ? { ...state.conditions, ...state.overrides } : state.conditions)

function effectiveConditions(cond) {
  if (!state.overrides) return cond
  return { ...cond, ...state.overrides }
}

async function refresh() {
  try {
    const live = await fetchConditions()
    applyConditions(effectiveConditions(live))
    console.log('[curlysim] live conditions', live)
  } catch (err) {
    console.warn('[curlysim] fetch failed, using previous/default conditions', err)
  }
}
refresh()
setInterval(refresh, 15 * 60 * 1000)
// crowd drifts with the time of day even between data refreshes
setInterval(() => {
  surfers.populate(state.conditions, waveField.faceHeight, simDate(), sky.env.sunAltitudeDeg)
}, 5 * 60 * 1000)

// debug panel behind ?debug — the public page stays clean
if (new URLSearchParams(location.search).has('debug')) {
  import('./debug.js').then(({ initDebug }) => initDebug(state, applyConditions, waveField, sky, ocean))
}
// console access for tinkering (no UI)
window.curlysim = {
  state,
  applyConditions,
  waveField,
  sky,
  pov,
  body,
  surfers,
  ocean,
  scene,
  renderer,
  quality: null,
  setDev(o) {
    localStorage.setItem('curlysim-dev', JSON.stringify(o))
    state.overrides = o
    applyConditions({ ...state.conditions, ...o })
  },
  clearDev() {
    localStorage.removeItem('curlysim-dev')
    state.overrides = null
  },
}

function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h)
  pov.camera.aspect = w / h
  pov.camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

const quality = new AdaptiveQuality(renderer, resize)
window.curlysim.quality = quality

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta()
  const t = clock.elapsedTime
  quality.tick(dt)
  waveField.update(dt) // advance the wave train
  const env = sky.update(simDate(), state.conditions, pov.camera)
  // eyes adjust in the dark: raise exposure at night so moonlit water and waves stay readable
  renderer.toneMappingExposure = 0.55 + 0.9 * (1 - env.dayFactor)
  pov.update(dt, t)
  body.update(dt, t)
  ocean.update(t, pov.camera, env)
  weather.update(dt, t, pov.camera)
  trees.update(t)
  surfers.update(t, dt)
  renderer.render(scene, pov.camera)
})
