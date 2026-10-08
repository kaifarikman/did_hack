export interface FrameScheduler {
  request(callback: (now: number) => void): number
  cancel(handle: number): void
}

export interface FrameLoop {
  wake(): void
  stop(): void
  readonly running: boolean
}

export const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
}

export function createFrameLoop(
  step: (now: number) => boolean,
  frames: FrameScheduler,
): FrameLoop {
  let handle: number | null = null
  const tick = (now: number): void => {
    handle = null
    if (step(now)) handle = frames.request(tick)
  }
  return {
    wake() {
      if (handle === null) handle = frames.request(tick)
    },
    stop() {
      if (handle !== null) frames.cancel(handle)
      handle = null
    },
    get running() {
      return handle !== null
    },
  }
}
