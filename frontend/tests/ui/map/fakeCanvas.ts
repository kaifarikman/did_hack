export interface CanvasCall {
  name: string
  args: unknown[]
}

export interface FakeContext {
  context: CanvasRenderingContext2D
  calls: CanvasCall[]
  state: Record<string, unknown>
}

const CHAR_WIDTH = 6

export function fakeContext(): FakeContext {
  const calls: CanvasCall[] = []
  const state: Record<string, unknown> = {}
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    measureText: (text) => ({
      width: String(text).length * CHAR_WIDTH,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(Number(width) * Number(height) * 4),
    }),
  }
  const context = new Proxy(state, {
    get(target, property) {
      if (typeof property !== "string") return undefined
      if (property in target) return target[property]
      return (...args: unknown[]) => {
        calls.push({ name: property, args })
        return methods[property]?.(...args)
      }
    },
    set(target, property, value) {
      if (typeof property === "string") target[property] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { context, calls, state }
}

export function installFakeDocument(): void {
  const canvas = { width: 0, height: 0, getContext: () => fakeContext().context }
  Object.assign(globalThis, { document: { createElement: () => canvas } })
}

export function removeFakeDocument(): void {
  Reflect.deleteProperty(globalThis, "document")
}
