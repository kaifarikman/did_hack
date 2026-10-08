interface RandomSource {
  readonly randomUUID?: (() => string) | undefined
  readonly getRandomValues?: (<T extends Uint8Array>(array: T) => T) | undefined
}

const UUID_BYTES = 16
const BYTE_RANGE = 256
const HEX_RADIX = 16
const VERSION_INDEX = 6
const VARIANT_INDEX = 8
const VERSION_MASK = 0x0f
const VERSION_BITS = 0x40
const VARIANT_MASK = 0x3f
const VARIANT_BITS = 0x80
const GROUP_ENDS = [4, 6, 8, 10, 16] as const

function randomBytes(source: RandomSource | undefined): Uint8Array {
  const bytes = new Uint8Array(UUID_BYTES)
  if (typeof source?.getRandomValues === "function") return source.getRandomValues(bytes)
  return bytes.map(() => Math.floor(Math.random() * BYTE_RANGE))
}

export function createRequestId(
  source: RandomSource | undefined = globalThis.crypto as RandomSource | undefined,
): string {
  if (typeof source?.randomUUID === "function") return source.randomUUID()
  const bytes = randomBytes(source)
  bytes[VERSION_INDEX] = ((bytes[VERSION_INDEX] ?? 0) & VERSION_MASK) | VERSION_BITS
  bytes[VARIANT_INDEX] = ((bytes[VARIANT_INDEX] ?? 0) & VARIANT_MASK) | VARIANT_BITS
  const hex = [...bytes].map((byte) => byte.toString(HEX_RADIX).padStart(2, "0"))
  let start = 0
  return GROUP_ENDS.map((end) => {
    const group = hex.slice(start, end).join("")
    start = end
    return group
  }).join("-")
}
