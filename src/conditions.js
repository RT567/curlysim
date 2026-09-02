// Live conditions for Curl Curl from Open-Meteo (free, keyless, CORS-open).
// Two fetches: marine (swell decomposition, sea temp, tide-ish sea level) and
// forecast (wind, temp, cloud, rain). Falls back to a plausible default day if
// offline, and refreshes every 15 minutes.

import { LAT, LON } from './geo.js'

const MARINE_URL =
  `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}` +
  `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,` +
  `secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,` +
  `wind_wave_height,wind_wave_direction,wind_wave_period,sea_surface_temperature,sea_level_height_msl` +
  `&timezone=Australia%2FSydney`

const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
  `&timezone=Australia%2FSydney&wind_speed_unit=kn`

// A pleasant default: 1.2 m SE groundswell, light offshore, scattered cloud.
export const DEFAULT_CONDITIONS = {
  swells: [
    { height: 1.2, period: 10, dir: 140 },
    { height: 0.3, period: 6, dir: 90 },
  ],
  totalWave: 1.3,
  windKn: 7,
  windDirFrom: 300,
  gustKn: 10,
  cloudCover: 30,
  precip: 0,
  weatherCode: 2,
  airTemp: 19,
  seaTemp: 18,
  seaLevel: 0,
  live: false,
}

export async function fetchConditions() {
  const [marine, weather] = await Promise.all([
    fetch(MARINE_URL).then((r) => r.json()),
    fetch(WEATHER_URL).then((r) => r.json()),
  ])
  const m = marine.current
  const w = weather.current

  const swells = []
  if (m.swell_wave_height > 0.05) {
    swells.push({ height: m.swell_wave_height, period: m.swell_wave_period, dir: m.swell_wave_direction })
  }
  if (m.secondary_swell_wave_height > 0.1) {
    swells.push({
      height: m.secondary_swell_wave_height,
      period: m.secondary_swell_wave_period,
      dir: m.secondary_swell_wave_direction,
    })
  }
  // No decomposed swell reported (pure windsea day): fall back to total sea state.
  if (swells.length === 0 && m.wave_height > 0.05) {
    swells.push({ height: m.wave_height, period: m.wave_period, dir: m.wave_direction })
  }

  return {
    swells,
    totalWave: m.wave_height,
    windWave: { height: m.wind_wave_height, period: m.wind_wave_period, dir: m.wind_wave_direction },
    windKn: w.wind_speed_10m,
    windDirFrom: w.wind_direction_10m,
    gustKn: w.wind_gusts_10m,
    cloudCover: w.cloud_cover,
    precip: w.precipitation,
    weatherCode: w.weather_code,
    airTemp: w.temperature_2m,
    seaTemp: m.sea_surface_temperature,
    seaLevel: m.sea_level_height_msl,
    live: true,
  }
}
