import "i18next"
import type { Dictionary, Namespace } from "./resources"

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other"

type StripPlural<Key extends string> = Key extends `${infer Base}_${PluralSuffix}` ? Base : Key

type LeafKeys<Tree, Prefix extends string = ""> = {
  [Key in keyof Tree & string]: Tree[Key] extends string
    ? `${Prefix}${Key}`
    : LeafKeys<Tree[Key], `${Prefix}${Key}.`>
}[keyof Tree & string]

type DictionaryKeys = {
  [Ns in Namespace]: `${Ns}:${StripPlural<LeafKeys<Dictionary[Ns]>>}`
}[Namespace]

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common"
    resources: Dictionary
    returnNull: false
  }
}

declare module "@/domain/message" {
  interface MessageCatalog extends Record<DictionaryKeys, true> {}
}
