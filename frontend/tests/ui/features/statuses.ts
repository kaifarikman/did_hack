import type { RunStatus } from "@/domain/contract"

export const RUN_STATUSES_FOR_TEST: readonly RunStatus[] = [
  "idle",
  "starting",
  "running",
  "returning",
  "stopping",
  "completed",
  "stopped",
  "failed",
]
