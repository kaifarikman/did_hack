import { describe, expect, it } from "vitest"
import { createRequestId } from "@/adapters/requestId"

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("createRequestId", () => {
  it("uses randomUUID in a secure context", () => {
    expect(createRequestId({ randomUUID: () => "secure-id" })).toBe("secure-id")
  })

  it("builds a v4 UUID from getRandomValues over plain http", () => {
    const id = createRequestId({
      getRandomValues: <T extends Uint8Array>(array: T) => array.fill(0xff),
    })
    expect(id).toMatch(UUID_V4)
  })

  it("still returns a UUID without any crypto", () => {
    const ids = new Set([createRequestId({}), createRequestId({})])
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(ids.size).toBe(2)
  })
})
