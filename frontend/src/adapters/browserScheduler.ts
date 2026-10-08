import type { Scheduler } from "../application/ports"

export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => {
    const handle = window.setTimeout(callback, delayMs)
    return () => window.clearTimeout(handle)
  },
}
