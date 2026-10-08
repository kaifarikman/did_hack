import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import type { Message } from "@/domain/message"
import { NAMESPACES } from "./resources"

export function useMessageText(): (message: Message) => string {
  const { t } = useTranslation(NAMESPACES)
  return useCallback((message: Message) => t(message.key, message.params ?? {}), [t])
}
