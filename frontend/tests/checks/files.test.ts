import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { collectFiles, frontendRoot, MissingSourcesError } from "../../scripts/checks/files.ts"

const roots: string[] = []

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "checks-"))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("collectFiles", () => {
  it("scans sources, end-to-end tests, docker scripts and root configs", () => {
    const root = tree({
      "src/a.ts": "",
      "e2e/a.spec.ts": "",
      "docker/10-resolver.envsh": "",
      "docker/default.conf.template": "",
      "public/probe.css": "",
      "public/fonts/a.woff2": "",
      "index.html": "",
      Dockerfile: "",
      "playwright.config.ts": "",
      "tsconfig.json": "",
      "node_modules/x/index.js": "",
    })
    expect(collectFiles(root).map((item) => item.path)).toEqual([
      "Dockerfile",
      "docker/10-resolver.envsh",
      "docker/default.conf.template",
      "e2e/a.spec.ts",
      "index.html",
      "playwright.config.ts",
      "public/probe.css",
      "src/a.ts",
      "tsconfig.json",
    ])
  })

  it("fails instead of passing when there are no sources", () => {
    expect(() => collectFiles(tree({ "README.md": "" }))).toThrow(MissingSourcesError)
  })

  it("roots the checks at the frontend, wherever they are started from", () => {
    expect(frontendRoot(resolve(process.cwd(), "scripts", "checks"))).toBe(process.cwd())
  })
})
