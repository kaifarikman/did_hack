import { type AstNode, parseScript, walkAst } from "../parse.ts"
import { type Check, isScript, type SourceFile, type Violation } from "../types.ts"
import { literalStrings } from "./texts.ts"

const TIMER_CALLS = new Set(["setTimeout", "setInterval"])
const TIMING_KEYS = new Set(["duration", "delay", "endDelay"])
const EASING_LITERAL =
  /cubic-bezier\(|steps\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear)(?![\w-])/
const SCOPE = "src/ui/"

type Constants = ReadonlyMap<string, AstNode>

function calleeName(node: AstNode): string {
  const callee = node.callee as AstNode | undefined
  if (callee?.type === "Identifier") return String(callee.name)
  const property = callee?.property as AstNode | undefined
  return callee?.type === "MemberExpression" && property !== undefined
    ? String(property.name)
    : ""
}

function fileConstants(program: AstNode): Constants {
  const constants = new Map<string, AstNode>()
  walkAst(program, (node) => {
    const id = node.type === "VariableDeclarator" ? (node.id as AstNode | undefined) : undefined
    const init = node.init as AstNode | null | undefined
    if (id?.type === "Identifier" && init !== null && init !== undefined)
      constants.set(String(id.name), init)
  })
  return constants
}

const OPERATIONS: Readonly<Record<string, (left: number, right: number) => number>> = {
  "+": (left, right) => left + right,
  "-": (left, right) => left - right,
  "*": (left, right) => left * right,
  "/": (left, right) => left / right,
}

export function constantNumber(
  node: AstNode | null | undefined,
  constants: Constants,
  depth = 0,
): number | null {
  if (node === null || node === undefined || depth > 8) return null
  if (node.type === "Literal") return typeof node.value === "number" ? node.value : null
  if (node.type === "Identifier")
    return constantNumber(constants.get(String(node.name)), constants, depth + 1)
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const value = constantNumber(node.argument as AstNode, constants, depth + 1)
    return value === null ? null : -value
  }
  if (node.type === "ParenthesizedExpression" || node.type === "TSAsExpression")
    return constantNumber(node.expression as AstNode, constants, depth + 1)
  if (node.type !== "BinaryExpression") return null
  const operation = OPERATIONS[String(node.operator)]
  const left = constantNumber(node.left as AstNode, constants, depth + 1)
  const right = constantNumber(node.right as AstNode, constants, depth + 1)
  return operation === undefined || left === null || right === null
    ? null
    : operation(left, right)
}

function positive(node: AstNode | undefined, constants: Constants): boolean {
  const value = constantNumber(node, constants)
  return value !== null && value > 0
}

function callProblem(node: AstNode, constants: Constants): string | null {
  const name = calleeName(node)
  const args = (node.arguments as readonly AstNode[] | undefined) ?? []
  if (TIMER_CALLS.has(name) && positive(args[1], constants))
    return `${name} with a literal delay`
  if (name === "animate" && positive(args[1], constants))
    return "animate with a literal duration"
  if (
    node.type === "NewExpression" &&
    name === "KeyframeEffect" &&
    positive(args[2], constants)
  )
    return "KeyframeEffect with a literal duration"
  return null
}

function propertyProblem(node: AstNode, constants: Constants): string | null {
  const key = node.key as AstNode | undefined
  const name = String(key?.name ?? key?.value ?? "")
  const value = node.value as AstNode | undefined
  if (TIMING_KEYS.has(name) && positive(value, constants)) return "literal motion timing"
  if (name === "easing" && literalStrings(value).some((text) => EASING_LITERAL.test(text)))
    return "literal easing"
  return null
}

export function timingProblems(path: string, text: string): string[] {
  const program = parseScript(path, text).program
  const constants = fileConstants(program)
  const problems: string[] = []
  walkAst(program, (node) => {
    const problem =
      node.type === "CallExpression" || node.type === "NewExpression"
        ? callProblem(node, constants)
        : node.type === "Property"
          ? propertyProblem(node, constants)
          : null
    if (problem !== null) problems.push(problem)
  })
  return problems
}

export const tsTimings: Check = {
  id: "ts-timings",
  run: (files) =>
    files
      .filter((file: SourceFile) => file.path.startsWith(SCOPE) && isScript(file.path))
      .flatMap((file): Violation[] =>
        timingProblems(file.path, file.text).map((message) => ({ file: file.path, message })),
      ),
}
