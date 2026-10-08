import type { CSSProperties } from "react"

export type StaggerStyle = CSSProperties & { readonly "--i": number }

export function staggerStyle(index: number): StaggerStyle {
  return { "--i": Math.max(0, Math.trunc(index)) }
}
