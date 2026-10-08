import { describe, expect, it } from "vitest"
import { readCanvasPalette } from "@/ui/features/map/canvasPalette"

describe("canvas palette", () => {
  it("reads the canvas palette by role", () => {
    document.documentElement.style.setProperty("--data-sample", "olive")
    document.documentElement.style.setProperty("--data-hazard", "sienna")
    const palette = readCanvasPalette()
    expect(palette.sample).toBe("olive")
    expect(palette.hazard).toBe("sienna")
    expect(palette.robot).toBe("")
  })
})
