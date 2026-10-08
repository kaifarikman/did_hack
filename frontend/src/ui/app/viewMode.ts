export type ViewMode = "default" | "show"

const VIEW_PARAMETER = "view"

export function readViewMode(search: string): ViewMode {
  return new URLSearchParams(search).get(VIEW_PARAMETER) === "show" ? "show" : "default"
}
