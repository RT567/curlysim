// Dev-only panel (?debug): override conditions and scrub the clock to test
// looks without waiting for the weather. Never loaded on the plain URL.

import GUI from 'lil-gui'

export function initDebug(state, applyConditions, waveField, sky, ocean) {
  const gui = new GUI({ title: 'curlysim debug' })
  const o = {
    live: true,
    swellHeight: state.conditions.swells[0]?.height ?? 1.2,
    swellPeriod: state.conditions.swells[0]?.period ?? 10,
    swellDir: state.conditions.swells[0]?.dir ?? 140,
    windKn: state.conditions.windKn,
    windDirFrom: state.conditions.windDirFrom,
    cloudCover: state.conditions.cloudCover,
    precip: state.conditions.precip,
    timeOffsetHours: 0,
  }

  const push = () => {
    if (o.live) {
      state.overrides = null
      return
    }
    state.overrides = {
      swells: [{ height: o.swellHeight, period: o.swellPeriod, dir: o.swellDir }],
      windKn: o.windKn,
      windDirFrom: o.windDirFrom,
      cloudCover: o.cloudCover,
      precip: o.precip,
    }
    applyConditions({ ...state.conditions, ...state.overrides })
  }

  gui.add(o, 'live').name('use live data').onChange(push)
  gui.add(o, 'swellHeight', 0, 5, 0.1).onChange(push)
  gui.add(o, 'swellPeriod', 4, 18, 0.5).onChange(push)
  gui.add(o, 'swellDir', 0, 360, 5).onChange(push)
  gui.add(o, 'windKn', 0, 40, 1).onChange(push)
  gui.add(o, 'windDirFrom', 0, 360, 5).onChange(push)
  gui.add(o, 'cloudCover', 0, 100, 5).onChange(push)
  gui.add(o, 'precip', 0, 10, 0.5).onChange(push)
  gui
    .add(o, 'timeOffsetHours', -24, 24, 0.5)
    .name('clock offset (h)')
    .onChange((v) => {
      state.timeOffsetHours = v
    })
  if (ocean) {
    const p = { phaseColors: ocean.uniforms.uPhaseDebug.value > 0.5 }
    gui
      .add(p, 'phaseColors')
      .name('wave phase colors')
      .onChange((v) => {
        ocean.uniforms.uPhaseDebug.value = v ? 1 : 0
      })
  }

  const info = {
    get faceHeight() {
      return waveField.faceHeight.toFixed(2) + ' m'
    },
    get breakLine() {
      return waveField.xBreak.toFixed(0) + ' m out'
    },
    get sunAlt() {
      return sky.env.sunAltitudeDeg.toFixed(1) + ' deg'
    },
  }
  const f = gui.addFolder('computed')
  f.add(info, 'faceHeight').listen().disable()
  f.add(info, 'breakLine').listen().disable()
  f.add(info, 'sunAlt').listen().disable()
}
