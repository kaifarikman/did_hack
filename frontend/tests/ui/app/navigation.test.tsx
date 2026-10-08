import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useNavigation } from "@/ui/app/useNavigation"
import { exampleMap, idle, running } from "../../support"
import { viewOf } from "../features/views"

const point = { position_x_m: -0.5, position_y_m: 0.25 }
const ready = () => viewOf({ snapshot: idle(), map: exampleMap(), connection: "live" })
describe("navigation draft coordination", () => {
  it("map picking only prepares a target, stale connection requires confirmation", () => {
    const view = ready()
    const { result, rerender } = renderHook(({ current }) => useNavigation(current), {
      initialProps: { current: view },
    })
    act(() => result.current.setTaskType("navigation"))
    act(() => result.current.pick(point))
    expect(result.current.evaluation.target).toEqual({ ...point, map_id: view.map?.map_id })
    rerender({ current: { ...view, connection: "stale" } })
    expect(result.current.selectable).toBe(false)
    expect(result.current.evaluation.target).toBeNull()
    rerender({ current: view })
    expect(result.current.evaluation.problem).toBe("map_changed")
    act(() => result.current.confirm())
    expect(result.current.evaluation.target).not.toBeNull()
  })
  it("active missions lock edits and clicks", () => {
    const view = ready()
    const { result, rerender } = renderHook(({ current }) => useNavigation(current), {
      initialProps: { current: view },
    })
    act(() => result.current.setTaskType("navigation"))
    act(() => result.current.pick(point))
    rerender({ current: { ...view, snapshot: running() } })
    act(() => result.current.update("xText", "0"))
    act(() => result.current.clear())
    act(() => result.current.pick({ position_x_m: 0, position_y_m: 0 }))
    expect(result.current.locked).toBe(true)
    expect(result.current.evaluation.point).toEqual(point)
  })
  it("new map invalidates the draft while preserving coordinates", () => {
    const view = ready()
    const { result, rerender } = renderHook(({ current }) => useNavigation(current), {
      initialProps: { current: view },
    })
    act(() => result.current.setTaskType("navigation"))
    act(() => result.current.pick(point))
    rerender({
      current: {
        ...view,
        map: { ...exampleMap(), map_id: "next" },
        snapshot: { ...idle(), map_id: "next" },
      },
    })
    expect(result.current.evaluation.point).toEqual(point)
    expect(result.current.evaluation.problem).toBe("map_changed")
    act(() => result.current.confirm())
    expect(result.current.evaluation.target?.map_id).toBe("next")
  })
})
