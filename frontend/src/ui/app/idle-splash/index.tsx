import { useState } from "react"
import type { MissionViewState } from "@/application/viewState"
import { useMessageText } from "@/ui/shared/i18n"
import { Swap, useLatched, usePresence } from "@/ui/shared/motion"
import { EmptyState } from "@/ui/shared/ui"
import { splashCopy } from "./copy"
import styles from "./styles.module.css"

export { type SplashCopy, type SplashKind, splashCopy } from "./copy"

export interface IdleSplashProps {
  readonly view: MissionViewState
}

export function IdleSplash({ view }: IdleSplashProps) {
  const text = useMessageText()
  const copy = splashCopy(view)
  const open = copy !== null
  const [initial, setInitial] = useState(open)
  if (initial && !open) setInitial(false)
  const presence = usePresence(open)
  const shown = splashCopy(useLatched(view, open))
  if (!presence.mounted || shown === null) return null
  return (
    <div
      className={styles.splash}
      data-state={presence.state}
      data-initial={initial}
      data-motion="fade"
      data-kind={shown.kind}
      onAnimationEnd={presence.onAnimationEnd}
    >
      <Swap swapKey={shown.kind} as="div">
        <EmptyState
          size="hero"
          icon={shown.icon}
          title={text(shown.title)}
          description={text(shown.description)}
        />
      </Swap>
    </div>
  )
}
