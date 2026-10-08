import { type RenderOptions, type RenderResult, render } from "@testing-library/react"
import type { ReactElement } from "react"
import { LocaleProvider } from "@/ui/shared/i18n"

export function renderWithLocale(
  ui: ReactElement,
  options: Omit<RenderOptions, "wrapper"> = {},
): RenderResult {
  return render(ui, { ...options, wrapper: LocaleProvider })
}
