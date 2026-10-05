// Render quality: phone defaults + a one-way adaptive step.
//
// Phones get a lower pixel-ratio cap and a thinner ocean grid (the ocean
// vertex shader is most of the frame). Desktop keeps the full look. If the
// frame rate still sits under TARGET_FPS (a slow GPU, or a phone that has
// heated up and throttled), the pixel ratio steps down; it only steps if
// that actually helps, so a 30 Hz-capped display (iOS Low Power Mode) is
// left alone.

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const small = Math.min(screen.width, screen.height) < 820
export const MOBILE = coarse || small

export const QUALITY = {
  mobile: MOBILE,
  pixelRatio: Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2),
  ocean: MOBILE ? 0.7 : 1, // grid density factor for the ocean tiers
}

const TARGET_FPS = 40
const WINDOW = 2 // s per measurement
const WARMUP = 4 // s ignored after load (shader compile, first fetch)
const STEP = 0.8
const MIN_RATIO = 0.75

export class AdaptiveQuality {
  constructor(renderer, onChange) {
    this.renderer = renderer
    this.onChange = onChange
    this.ratio = QUALITY.pixelRatio
    this.prev = null // { ratio, fps } before the last step
    this.locked = false
    this._t = -WARMUP
    this._n = 0
    this._stall = false
  }

  // call once per frame with the real (unclamped) frame time
  tick(dt) {
    if (this.locked) return
    if (dt > 0.25 || document.hidden) this._stall = true // tab switch / hitch: not a GPU signal
    this._t += dt
    if (this._t < 0) return
    this._n++
    if (this._t < WINDOW) return
    const fps = this._n / this._t
    const stalled = this._stall
    this._t = 0
    this._n = 0
    this._stall = false
    if (stalled || fps >= TARGET_FPS) return
    if (this.prev && fps < this.prev.fps * 1.08) {
      // the last step bought nothing (vsync-capped, or CPU-bound): undo it
      this._set(this.prev.ratio)
      this.locked = true
      return
    }
    if (this.ratio <= MIN_RATIO) {
      this.locked = true
      return
    }
    this.prev = { ratio: this.ratio, fps }
    this._set(Math.max(this.ratio * STEP, MIN_RATIO))
  }

  _set(r) {
    this.ratio = r
    this.renderer.setPixelRatio(r)
    this.onChange?.()
    console.info(`[curlysim] pixel ratio -> ${r.toFixed(2)}`)
  }
}
