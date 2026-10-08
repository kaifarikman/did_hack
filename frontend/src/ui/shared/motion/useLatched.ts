import { useState } from "react"

export function useLatched<T>(value: T, open: boolean): T {
  const [latched, setLatched] = useState(value)
  if (open && latched !== value) setLatched(value)
  return open ? value : latched
}
