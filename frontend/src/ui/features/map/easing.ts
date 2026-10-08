export type Easing = (progress: number) => number

const CUBIC_BEZIER =
  /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/
const NEWTON_STEPS = 8
const BISECTION_STEPS = 20
const EPSILON = 1e-6

export const linear: Easing = (progress) => progress

function axis(p1: number, p2: number, t: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t
}

function slope(p1: number, p2: number, t: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * p1 + 6 * inverse * t * (p2 - p1) + 3 * t * t * (1 - p2)
}

function solveT(x1: number, x2: number, x: number): number {
  let t = x
  for (let step = 0; step < NEWTON_STEPS; step += 1) {
    const error = axis(x1, x2, t) - x
    if (Math.abs(error) < EPSILON) return t
    const derivative = slope(x1, x2, t)
    if (Math.abs(derivative) < EPSILON) break
    t -= error / derivative
  }
  let low = 0
  let high = 1
  t = x
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const value = axis(x1, x2, t)
    if (Math.abs(value - x) < EPSILON) return t
    if (value < x) low = t
    else high = t
    t = (low + high) / 2
  }
  return t
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  return (progress) => {
    if (progress <= 0) return 0
    if (progress >= 1) return 1
    return axis(y1, y2, solveT(x1, x2, progress))
  }
}

export function parseEasing(value: string): Easing {
  const match = CUBIC_BEZIER.exec(value)
  if (match === null) return linear
  const [, x1 = "0", y1 = "0", x2 = "1", y2 = "1"] = match
  return cubicBezier(Number(x1), Number(y1), Number(x2), Number(y2))
}
