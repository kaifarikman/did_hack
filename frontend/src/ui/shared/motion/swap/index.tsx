import { clsx } from "clsx"
import {
  type AnimationEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { DurationToken } from "../cssTokens"
import { fallbackDelay, type ReducedFadeToken } from "../fallbackDelay"
import styles from "./styles.module.css"

export type SwapPhase = "idle" | "out" | "in"

export interface SwapProps {
  readonly swapKey: string | number
  readonly as?: "span" | "div"
  readonly className?: string | undefined
  readonly children: ReactNode
}

interface Shown {
  readonly key: string | number
  readonly children: ReactNode
}

const PHASE_TOKEN: Readonly<Record<Exclude<SwapPhase, "idle">, DurationToken>> = {
  out: "--dur-fast-exit",
  in: "--dur-fast",
}

const PHASE_REDUCED_FADE: Readonly<Record<Exclude<SwapPhase, "idle">, ReducedFadeToken>> = {
  out: "--reduced-fade-exit",
  in: "--reduced-fade",
}

export function Swap({ swapKey, as: Tag = "span", className, children }: SwapProps) {
  const [shown, setShown] = useState<Shown>({ key: swapKey, children })
  const [phase, setPhase] = useState<SwapPhase>("idle")
  const elementRef = useRef<HTMLElement | null>(null)
  const latestChildren = useRef(children)
  latestChildren.current = children

  if (phase === "idle" && shown.key !== swapKey) setPhase("out")

  const advance = useCallback(() => {
    if (phase === "out") {
      setShown({ key: swapKey, children: latestChildren.current })
      setPhase("in")
    } else if (phase === "in") {
      setPhase(shown.key === swapKey ? "idle" : "out")
    }
  }, [phase, swapKey, shown.key])

  useLayoutEffect(() => {
    const element = elementRef.current
    if (element === null) return
    if (phase === "out") element.style.minHeight = `${element.getBoundingClientRect().height}px`
    if (phase === "idle") element.style.removeProperty("min-height")
  }, [phase])

  useEffect(() => {
    if (phase === "idle") return
    const timer = window.setTimeout(
      advance,
      fallbackDelay(PHASE_TOKEN[phase], PHASE_REDUCED_FADE[phase]),
    )
    return () => window.clearTimeout(timer)
  }, [phase, advance])

  const onAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) advance()
  }

  const content = phase === "idle" ? children : shown.children

  return (
    <Tag
      ref={(element: HTMLElement | null) => {
        elementRef.current = element
      }}
      className={clsx(styles.swap, Tag === "span" && styles.inline, className)}
      data-swap={phase}
      data-motion="fade"
      onAnimationEnd={onAnimationEnd}
    >
      {content}
    </Tag>
  )
}
