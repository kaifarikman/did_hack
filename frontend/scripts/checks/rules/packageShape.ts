import { type Check, directoryOf, extensionOf, isTest, type Violation } from "../types.ts"

export const MAX_SOURCES = 20
export const MAX_TESTS = 30

const PACKAGE_ROOTS = ["src/", "tests/", "e2e/", "scripts/"]
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"])
const FORBIDDEN_NAMES = new Set([
  "utils",
  "util",
  "helpers",
  "helper",
  "common",
  "lib",
  "libs",
  "misc",
])
const SHARED_ALLOWED = ["src/ui/shared", "tests/shared"]

function inPackageRoot(path: string): boolean {
  return PACKAGE_ROOTS.some((root) => path.startsWith(root))
}

export const packageSize: Check = {
  id: "package-size",
  run: (files) => {
    const sources = new Map<string, number>()
    const tests = new Map<string, number>()
    for (const file of files) {
      if (!inPackageRoot(file.path) || !SOURCE_EXTENSIONS.has(extensionOf(file.path))) continue
      const bucket = isTest(file.path) ? tests : sources
      const directory = directoryOf(file.path)
      bucket.set(directory, (bucket.get(directory) ?? 0) + 1)
    }
    const over = (bucket: Map<string, number>, limit: number, kind: string): Violation[] =>
      [...bucket]
        .filter(([, count]) => count > limit)
        .map(([directory, count]) => ({
          file: directory,
          message: `${count} ${kind} > ${limit}`,
        }))
    return [...over(sources, MAX_SOURCES, "sources"), ...over(tests, MAX_TESTS, "tests")]
  },
}

function badSegment(directory: string): string | null {
  const segments = directory.split("/")
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? ""
    if (FORBIDDEN_NAMES.has(segment)) return segment
    const prefix = segments.slice(0, index + 1).join("/")
    if (segment === "shared" && !SHARED_ALLOWED.includes(prefix)) return segment
  }
  return null
}

export const packageSubject: Check = {
  id: "package-subject",
  run: (files) => {
    const directories = new Set(
      files.filter((file) => inPackageRoot(file.path)).map((file) => directoryOf(file.path)),
    )
    return [...directories].flatMap((directory): Violation[] => {
      const segment = badSegment(directory)
      return segment === null
        ? []
        : [{ file: directory, message: `directory name "${segment}" has no subject` }]
    })
  },
}
