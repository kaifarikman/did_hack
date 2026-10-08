import type { MissionViewState } from "@/application/viewState"
import type { HealthStatus } from "@/domain/contract"
import type { Message } from "@/domain/message"
import type { IconName } from "@/ui/shared/ui"

export type SplashKind = "connecting" | "offline" | "starting" | "rejected" | "ready"

export interface SplashCopy {
  readonly kind: SplashKind
  readonly icon: IconName
  readonly title: Message
  readonly description: Message
}

function healthCopy(health: HealthStatus | null): SplashCopy {
  if (health === null || health.status === "starting") {
    return {
      kind: "starting",
      icon: "loader",
      title: { key: "mission:splash.startingTitle" },
      description: {
        key:
          health?.ros_connected === true
            ? "mission:splash.startingEnv"
            : "mission:splash.startingRos",
      },
    }
  }
  return {
    kind: "ready",
    icon: "robot",
    title: { key: "mission:splash.title" },
    description: {
      key: health.llm_available ? "mission:splash.description" : "mission:splash.readyFallback",
    },
  }
}

function isAwaitingRun(view: MissionViewState): boolean {
  const snapshot = view.snapshot
  return snapshot !== null && snapshot.status === "idle" && snapshot.run_id === null
}

function isStartRejected(view: MissionViewState): boolean {
  return view.command.phase === "failed" && view.command.kind === "start"
}

export function splashCopy(view: MissionViewState): SplashCopy | null {
  if (view.snapshot === null) {
    return view.connection === "stale"
      ? {
          kind: "offline",
          icon: "offline",
          title: { key: "mission:splash.offlineTitle" },
          description: { key: "mission:splash.offlineDescription" },
        }
      : {
          kind: "connecting",
          icon: "loader",
          title: { key: "mission:splash.connectingTitle" },
          description: { key: "mission:splash.connectingDescription" },
        }
  }
  if (!isAwaitingRun(view)) return null
  if (isStartRejected(view)) {
    return {
      kind: "rejected",
      icon: "alert",
      title: { key: "mission:splash.rejectedTitle" },
      description: view.command.message ?? { key: "mission:splash.rejectedDescription" },
    }
  }
  return healthCopy(view.health)
}
