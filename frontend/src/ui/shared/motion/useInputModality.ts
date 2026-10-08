import { useCallback, useState } from "react"

export interface InputModality {
  readonly instant: boolean
  readonly onKeyDown: () => void
  readonly onPointerDown: () => void
}

export function useInputModality(): InputModality {
  const [instant, setInstant] = useState(false)
  const onKeyDown = useCallback(() => setInstant(true), [])
  const onPointerDown = useCallback(() => setInstant(false), [])
  return { instant, onKeyDown, onPointerDown }
}
