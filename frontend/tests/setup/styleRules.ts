export function ruleBody(text: string, selector: string): string {
  const start = text.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no rule ${selector}`)
  return text.slice(start, text.indexOf("}", start))
}
