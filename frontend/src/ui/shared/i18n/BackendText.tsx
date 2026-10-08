import type { ReactNode } from "react"

export const BACKEND_CONTENT_LANG = "ru"

export type BackendTextElement = "span" | "p" | "div" | "li" | "dd" | "dt"

export interface BackendTextProps {
  readonly as?: BackendTextElement | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}

export function BackendText({ as: Tag = "span", className, children }: BackendTextProps) {
  return (
    <Tag lang={BACKEND_CONTENT_LANG} className={className}>
      {children}
    </Tag>
  )
}
