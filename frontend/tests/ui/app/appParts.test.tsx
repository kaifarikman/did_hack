import { screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppHeader } from "@/ui/app/app-header"
import { countTracks, MAX_SIDE_COLUMNS } from "@/ui/app/app-layout/gridColumns"
import { downloadJson } from "@/ui/app/download"
import { renderWithLocale } from "../features/render"

describe("side columns", () => {
  it("counts resolved grid tracks and caps them", () => {
    expect(countTracks("416px")).toBe(1)
    expect(countTracks("425.5px 425.5px")).toBe(2)
    expect(countTracks("300px 300px 300px")).toBe(MAX_SIDE_COLUMNS)
    expect(countTracks("none")).toBe(1)
  })
})

describe("downloadJson", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("clicks a link with the file name and revokes the URL after the click", () => {
    vi.useFakeTimers()
    const create = vi.fn(() => "blob:journal")
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download)
    })
    downloadJson("journal-run.json", { run_id: "run" })
    expect(clicks).toEqual(["journal-run.json"])
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith("blob:journal")
  })
})

describe("AppHeader connection", () => {
  it.each(["connecting", "live", "stale", "offline"] as const)(
    "labels the %s connection",
    (connection) => {
      renderWithLocale(
        <AppHeader
          title="title"
          connection={connection}
          connectionLabel={`label ${connection}`}
        />,
      )
      expect(screen.getByRole("status").textContent).toContain(`label ${connection}`)
    },
  )
})
