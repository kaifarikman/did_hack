export type Rgba = readonly [number, number, number, number]

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i
const RGB_FUNCTION =
  /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i

function alphaOf(raw: string | undefined): number {
  if (raw === undefined) return 1
  return raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw)
}

export function parseColor(value: string): Rgba | null {
  const text = value.trim()
  const short = HEX_SHORT.exec(text)
  if (short !== null) {
    const [, red = "0", green = "0", blue = "0"] = short
    return [
      Number.parseInt(red + red, 16),
      Number.parseInt(green + green, 16),
      Number.parseInt(blue + blue, 16),
      1,
    ]
  }
  const long = HEX_LONG.exec(text)
  if (long !== null) {
    const [, red = "00", green = "00", blue = "00", alpha] = long
    const opacity = alpha === undefined ? 1 : Number.parseInt(alpha, 16) / 255
    return [
      Number.parseInt(red, 16),
      Number.parseInt(green, 16),
      Number.parseInt(blue, 16),
      opacity,
    ]
  }
  const functional = RGB_FUNCTION.exec(text)
  if (functional !== null) {
    const [, red = "0", green = "0", blue = "0", alpha] = functional
    return [
      Number.parseFloat(red),
      Number.parseFloat(green),
      Number.parseFloat(blue),
      alphaOf(alpha),
    ]
  }
  return null
}

export function mixColor(from: Rgba, to: Rgba, ratio: number): Rgba {
  const t = Math.min(Math.max(ratio, 0), 1)
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
    from[3] + (to[3] - from[3]) * t,
  ]
}

export function toCss(color: Rgba): string {
  const [red, green, blue, alpha] = color
  return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${Number(alpha.toFixed(3))})`
}
