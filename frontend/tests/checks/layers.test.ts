import { describe, expect, it } from "vitest"
import { layerOf, layers } from "../../scripts/checks/rules/layers.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text = "export const value = 1\n"): SourceFile => ({ path, text })
const importing = (path: string, specifier: string) =>
  file(path, `import { value } from "${specifier}"\nexport const used = value\n`)

const TARGETS = [
  file("src/domain/contract.ts"),
  file("src/application/viewState.ts"),
  file("src/adapters/httpGateway.ts"),
  file("src/ui/shared/ui/index.ts"),
  file("src/ui/features/mission/mission-card/index.tsx"),
  file("src/ui/features/journal/journal-card/index.tsx"),
  file("src/ui/app/app-shell/index.tsx"),
]

describe("layers", () => {
  it("names the layer of a path", () => {
    expect(["src/domain/a.ts", "src/ui/features/x/a.ts", "src/main.tsx"].map(layerOf)).toEqual([
      "domain",
      "feature",
      "root",
    ])
  })

  it("passes dependencies that point inwards", () => {
    const files = [
      ...TARGETS,
      importing("src/application/run.ts", "../domain/contract"),
      importing("src/adapters/fixture.ts", "@/application/viewState"),
      importing("src/ui/shared/ui/x.ts", "@/domain/contract"),
      importing("src/ui/features/mission/a.ts", "@/ui/shared/ui"),
      importing("src/ui/features/mission/b.ts", "./mission-card"),
      importing("src/ui/app/x.ts", "@/ui/features/journal/journal-card"),
      importing("src/ui/features/mission/c.tsx", "react"),
      importing("src/main.tsx", "./adapters/httpGateway"),
    ]
    expect(layers.run(files)).toEqual([])
  })

  it.each([
    ["src/domain/probe.ts", "react"],
    ["src/domain/probe.ts", "i18next"],
    ["src/domain/probe.ts", "@/ui/shared/ui"],
    ["src/application/probe.ts", "react-i18next"],
    ["src/application/probe.ts", "@/adapters/httpGateway"],
    ["src/adapters/probe.ts", "@/ui/shared/ui"],
    ["src/ui/shared/ui/probe/index.tsx", "@/ui/features/mission/mission-card"],
    ["src/ui/shared/ui/probe/index.tsx", "@/ui/app/app-shell"],
    ["src/ui/features/mission/probe.ts", "@/ui/features/journal/journal-card"],
    ["src/ui/features/mission/probe.ts", "@/ui/app/app-shell"],
  ])("reports %s importing %s", (path, specifier) => {
    expect(layers.run([...TARGETS, importing(path, specifier)])).toHaveLength(1)
  })

  it("counts type-only imports as dependencies too", () => {
    const typeOnly = file(
      "src/domain/probe.ts",
      'import type { ReactNode } from "react"\nexport type Node = ReactNode\n',
    )
    expect(layers.run([typeOnly])).toHaveLength(1)
  })
})
