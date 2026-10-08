import { describe, expect, it } from "vitest"
import { ApiError, NetworkError, RequestTimeoutError } from "@/application/errors"
import { LocalizedError, msg } from "@/domain/message"
import { ContractError } from "@/domain/validation"
import { createI18n, describeError, errorKind } from "@/ui/shared/i18n"

describe("describeError", () => {
  it("returns the descriptor of a LocalizedError as is", () => {
    const descriptor = msg("errors:kind.timeout")
    expect(describeError(new LocalizedError(descriptor))).toBe(descriptor)
  })

  it("prefers a dictionary entry for a known api code", () => {
    const error = new ApiError(409, "run_conflict", "busy", false)
    expect(describeError(error)).toEqual({
      key: "errors:api.run_conflict",
      params: { detail: "busy" },
    })
  })

  it("falls back to the error kind for an unknown api code", () => {
    const error = new ApiError(503, "brand_new_code", "later", true)
    expect(describeError(error)).toEqual({
      key: "errors:kind.unavailable",
      params: { detail: "later" },
    })
  })

  it.each([
    [new ApiError(409, "x", "m", false), "conflict"],
    [new ApiError(422, "x", "m", false), "rejected"],
    [new ApiError(500, "x", "m", false), "server"],
    [new NetworkError(), "network"],
    [new RequestTimeoutError(), "timeout"],
    [new ContractError("bad"), "contract"],
    ["boom", "unknown"],
  ])("classifies %o as %s", (error, kind) => {
    expect(errorKind(error)).toBe(kind)
  })

  it("omits params when there is no detail", () => {
    expect(describeError("boom")).toEqual({ key: "errors:kind.unknown" })
  })

  it("keeps only server text as detail, not internal developer messages", () => {
    expect(describeError(new NetworkError())).toEqual({ key: "errors:kind.network" })
    expect(describeError(new ContractError("state.battery"))).toEqual({
      key: "errors:kind.contract",
    })
  })

  it("produces keys that exist in both dictionaries", () => {
    const ru = createI18n("ru")
    const en = createI18n("en")
    const message = describeError(new NetworkError())
    expect(ru.exists(message.key)).toBe(true)
    expect(en.t(message.key)).not.toBe(ru.t(message.key))
  })
})
