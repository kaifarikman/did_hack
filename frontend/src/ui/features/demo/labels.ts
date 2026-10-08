import type { MessageKey } from "@/domain/message"

export type DemoKey = Extract<MessageKey, `demo:${string}`>

export const DEMO_BADGE_LABEL: DemoKey = "demo:badge"
export const DEMO_PICKER_LABEL: DemoKey = "demo:picker"
