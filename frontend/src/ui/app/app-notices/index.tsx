import { connectionStatus, type MissionViewState } from "@/application/viewState"
import { useMessageText } from "@/ui/shared/i18n"
import { useLatched } from "@/ui/shared/motion"
import { Banner } from "@/ui/shared/ui"

export interface AppNoticesProps {
  readonly view: MissionViewState
}

function isStale(view: MissionViewState): boolean {
  return connectionStatus(view) === "stale"
}

export function AppNotices({ view }: AppNoticesProps) {
  const text = useMessageText()
  const stale = isStale(view)
  const detail = useLatched(view.connectionError, stale)
  const staleText =
    detail === null
      ? text({ key: "common:connection.staleBanner" })
      : text({ key: "common:connection.staleBannerDetail", params: { detail: text(detail) } })
  return (
    <Banner
      open={stale}
      tone="attention"
      icon="offline"
      title={text({ key: "common:connection.stale" })}
    >
      {staleText}
    </Banner>
  )
}
