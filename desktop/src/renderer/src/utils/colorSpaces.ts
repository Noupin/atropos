export type BgrColor = [number, number, number]

export type RgbColor = { r: number; g: number; b: number }

export type HsvColor = { h: number; s: number; v: number }

export type HslColor = { h: number; s: number; l: number }

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(Math.max(value, min), max)
}

export const parseBgrString = (value: string): BgrColor | null => {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((component) => Number.isFinite(Number(component)))
    ) {
      const [b, g, r] = parsed.map((component) => clamp(Number(component), 0, 255))
      return [b, g, r]
    }
  } catch (error) {
    return null
  }
  return null
}

export const formatBgrString = (bgr: BgrColor): string => {
  const [b, g, r] = bgr.map((component) => clamp(component, 0, 255))
  return JSON.stringify([Math.round(b), Math.round(g), Math.round(r)])
}

export const bgrToRgb = (bgr: BgrColor): RgbColor => {
  const [b, g, r] = bgr
  return { r, g, b }
}

export const rgbToBgr = (rgb: RgbColor): BgrColor => {
  const { r, g, b } = rgb
  return [clamp(Math.round(b), 0, 255), clamp(Math.round(g), 0, 255), clamp(Math.round(r), 0, 255)]
}

export const rgbToHex = (rgb: RgbColor): string => {
  const toHex = (component: number) => clamp(Math.round(component), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

export const hexToRgb = (hex: string): RgbColor | null => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return null
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  }
}

export const rgbToHsv = (rgb: RgbColor): HsvColor => {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6
    } else if (max === g) {
      h = (b - r) / delta + 2
    } else {
      h = (r - g) / delta + 4
    }
  }
  h = Math.round((h * 60 + 360) % 360)

  const s = max === 0 ? 0 : delta / max
  const v = max

  return { h, s: Math.round(s * 1000) / 10, v: Math.round(v * 1000) / 10 }
}

export const hsvToRgb = (hsv: HsvColor): RgbColor => {
  const h = clamp(hsv.h, 0, 360)
  const s = clamp(hsv.s / 100, 0, 1)
  const v = clamp(hsv.v / 100, 0, 1)

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (h >= 0 && h < 60) {
    rPrime = c
    gPrime = x
  } else if (h >= 60 && h < 120) {
    rPrime = x
    gPrime = c
  } else if (h >= 120 && h < 180) {
    gPrime = c
    bPrime = x
  } else if (h >= 180 && h < 240) {
    gPrime = x
    bPrime = c
  } else if (h >= 240 && h < 300) {
    rPrime = x
    bPrime = c
  } else {
    rPrime = c
    bPrime = x
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255)
  }
}

export const rgbToHsl = (rgb: RgbColor): HslColor => {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6
    } else if (max === g) {
      h = (b - r) / delta + 2
    } else {
      h = (r - g) / delta + 4
    }
  }
  h = Math.round((h * 60 + 360) % 360)

  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  return { h, s: Math.round(s * 1000) / 10, l: Math.round(l * 1000) / 10 }
}

const hueToRgb = (p: number, q: number, t: number): number => {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

export const hslToRgb = (hsl: HslColor): RgbColor => {
  const h = clamp(hsl.h, 0, 360) / 360
  const s = clamp(hsl.s / 100, 0, 1)
  const l = clamp(hsl.l / 100, 0, 1)

  if (s === 0) {
    const value = Math.round(l * 255)
    return { r: value, g: value, b: value }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255)
  const g = Math.round(hueToRgb(p, q, h) * 255)
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255)

  return { r, g, b }
}
