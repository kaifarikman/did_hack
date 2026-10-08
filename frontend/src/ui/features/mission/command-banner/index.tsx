import type { MissionController } from "@/application/missionController"
import type { CommandPhase, CommandState } from "@/application/viewState"
import { messageDetail } from "@/domain/message"
import { BackendText, useMessageText } from "@/ui/shared/i18n"
import { useLatched } from "@/ui/shared/motion"
import { Banner, type BannerTone, Button } from "@/ui/shared/ui"
import type { MissionKey } from "../labels"

export interface CommandBannerProps {
  readonly command: CommandState
  readonly controller: MissionController
}

type VisiblePhase = Exclude<CommandPhase, "idle">

const TONES: Readonly<Record<VisiblePhase, BannerTone>> = {
  sending: "info",
  awaiting: "info",
  unknown: "attention",
  failed: "critical",
}

function titleKey(command: CommandState, phase: VisiblePhase): MissionKey {
  if (phase === "unknown" && command.canRetry) return "mission:command.reconciled"
  return `mission:command.${phase}`
}

export function CommandBanner({ command, controller }: CommandBannerProps) {
  const text = useMessageText()
  const shown = useLatched(command, command.phase !== "idle")
  const phase = shown.phase === "idle" ? null : shown.phase
  const detail = messageDetail(shown.cause) ?? messageDetail(shown.message)
  const tone = phase === null ? "info" : TONES[phase]
  const retry =
    phase === "unknown" ? (
      <Button
        variant="ghost"
        size="compact"
        icon="retry"
        disabled={!shown.canRetry}
        onClick={() => void controller.retryCommand()}
      >
        {text({ key: "mission:action.retry" })}
      </Button>
    ) : undefined
  return (
    <Banner
      open={command.phase !== "idle"}
      tone={tone}
      title={phase === null ? "" : text({ key: titleKey(shown, phase) })}
      action={retry}
      {...(phase === "failed" ? { onDismiss: () => controller.dismissCommandMessage() } : {})}
    >
      {shown.message === null ? null : <p>{text(shown.message)}</p>}
      {shown.cause === null ? null : <p>{text(shown.cause)}</p>}
      {detail === null ? null : <BackendText as="p">{detail}</BackendText>}
    </Banner>
  )
}
