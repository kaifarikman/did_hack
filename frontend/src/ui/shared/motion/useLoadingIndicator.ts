import { useEffect, useRef, useState } from "react"
import { motionMs } from "./cssTokens"

export type LoadingIndicator = "none" | "skeleton" | "spinner" | "stale"

export interface LoadingInput {
  readonly pending: boolean
  readonly hasData: boolean
}

export function useLoadingIndicator({ pending, hasData }: LoadingInput): LoadingIndicator {
  const [indicator, setIndicator] = useState<LoadingIndicator>("none")
  const skeletonSince = useRef<number | null>(null)

  useEffect(() => {
    if (!pending) {
      const since = skeletonSince.current
      if (since === null) {
        setIndicator("none")
        return
      }
      const remaining = motionMs("--hold-skeleton") - (performance.now() - since)
      const release = () => {
        skeletonSince.current = null
        setIndicator("none")
      }
      if (remaining <= 0) {
        release()
        return
      }
      const timer = window.setTimeout(release, remaining)
      return () => window.clearTimeout(timer)
    }

    const first = window.setTimeout(() => {
      if (hasData) {
        setIndicator("stale")
        return
      }
      skeletonSince.current = performance.now()
      setIndicator("skeleton")
    }, motionMs("--delay-skeleton"))
    const second = hasData
      ? window.setTimeout(() => setIndicator("spinner"), motionMs("--delay-spinner"))
      : null
    return () => {
      window.clearTimeout(first)
      if (second !== null) window.clearTimeout(second)
    }
  }, [pending, hasData])

  return indicator
}
