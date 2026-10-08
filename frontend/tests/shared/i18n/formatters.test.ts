import { describe, expect, it, vi } from "vitest"
import { createFormatters } from "@/ui/shared/i18n"

describe("createFormatters", () => {
  const en = createFormatters("en")
  const ru = createFormatters("ru")

  it("formats numbers by locale", () => {
    expect(en.number(1234.5)).toBe("1,234.5")
    expect(ru.number(1234.5)).toMatch(/^1\s234,5$/)
  })

  it("formats percents from a ratio", () => {
    expect(en.percent(0.42)).toBe("42%")
    expect(ru.percent(0.42)).toMatch(/^42\s%$/)
  })

  it("formats measured units", () => {
    expect(en.unit(3.25, "meter", 1)).toBe("3.3 m")
    expect(ru.unit(3, "meter")).toMatch(/^3\s\S+$/)
    expect(ru.unit(3, "meter")).not.toBe(en.unit(3, "meter"))
  })

  it("formats durations from seconds", () => {
    expect(en.duration(5)).toMatch(/^5 secs?$/)
    expect(en.duration(125)).toMatch(/^2 mins?,? 5 secs?$/)
    expect(en.duration(3725)).toMatch(/^1 hrs?,? 2 mins?,? 5 secs?$/)
    expect(en.duration(-3)).toMatch(/^0 secs?$/)
  })

  it("joins lists by locale", () => {
    expect(en.list(["a", "b", "c"])).toBe("a, b and c")
  })
})

describe("formatter reuse", () => {
  it("builds one Intl.NumberFormat per option set, not one per telemetry tick", () => {
    const spy = vi.spyOn(Intl, "NumberFormat")
    const formatters = createFormatters("ru")
    for (let tick = 0; tick < 50; tick += 1) {
      formatters.percent(tick / 100)
      formatters.unit(tick, "meter", 1)
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
    spy.mockRestore()
  })
})
