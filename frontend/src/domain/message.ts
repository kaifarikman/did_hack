// biome-ignore lint/suspicious/noEmptyInterface: augmented by ui/shared/i18n with dictionary keys
export interface MessageCatalog {}

export type MessageKey = keyof MessageCatalog & string

export type MessageParams = Readonly<Record<string, string | number>>

export interface Message {
  readonly key: MessageKey
  readonly params?: MessageParams
}

export function msg(key: MessageKey, params?: MessageParams): Message {
  return params === undefined ? { key } : { key, params }
}

export function messageDetail(message: Message | null): string | null {
  const detail = message?.params?.detail
  return typeof detail === "string" && detail !== "" ? detail : null
}

export class LocalizedError extends Error {
  readonly descriptor: Message

  constructor(descriptor: Message, options?: ErrorOptions) {
    super(descriptor.key, options)
    this.name = "LocalizedError"
    this.descriptor = descriptor
  }
}
