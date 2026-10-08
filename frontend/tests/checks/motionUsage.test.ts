import { describe, expect, it } from "vitest"
import { globalStyles } from "../../scripts/checks/rules/cssStructure.ts"
import {
  accentText,
  hoverGate,
  motionLibraries,
  remoteAssets,
} from "../../scripts/checks/rules/motionUsage.ts"
import type { SourceFile } from "../../scripts/checks/types.ts"

const file = (path: string, text: string): SourceFile => ({ path, text })
const module = (css: string) => file("src/ui/shared/ui/box/styles.module.css", css)
const SEMANTIC = file(
  "src/ui/shared/styles/tokens/semantic.css",
  ":root { --action-primary: var(--vivid-teal); --text-accent: var(--vivid-teal); }",
)

describe("hover-gate", () => {
  it("passes hover inside the pointer media query and a static focus ring", () => {
    const css =
      "@media (hover: hover) and (pointer: fine) { .a:hover { color: var(--x); } }\n.a:focus-visible { outline: var(--ring); }\n.b { transition: var(--t); }\n.b:focus-visible { --thumb: var(--x); transition: none; }"
    expect(hoverGate.run([module(css)])).toEqual([])
  })

  it("reports bare hover and animated focus", () => {
    const css = ".a:hover { color: var(--x); }\n.a:focus-visible { transition: var(--t); }"
    expect(hoverGate.run([module(css)])).toHaveLength(2)
  })

  it("reports a focus change animated by the transition of its base class", () => {
    const css =
      ".ring { transition: var(--transition-control); }\n.ring:focus-visible { background-color: var(--surface-tint); }"
    expect(hoverGate.run([module(css)]).map((item) => item.message)).toEqual([
      ".ring:focus-visible change is animated by its base transition",
    ])
  })

  it("ignores the legacy global stylesheet outside shared styles", () => {
    expect(hoverGate.run([file("src/ui/styles.css", ".a:hover { color: red; }")])).toEqual([])
  })
})

describe("motion-libraries", () => {
  const manifest = (groups: Record<string, Record<string, string>>) =>
    file("package.json", JSON.stringify(groups))

  it("passes CSS, WAAPI and View Transitions only", () => {
    expect(motionLibraries.run([manifest({ dependencies: { react: "19" } })])).toEqual([])
  })

  it("reports animation libraries in every dependency group and scope", () => {
    const groups = {
      dependencies: { gsap: "3", "@motionone/dom": "10", "lottie-react": "2" },
      devDependencies: { "framer-motion": "12" },
      peerDependencies: { "@react-spring/web": "9" },
    }
    expect(motionLibraries.run([manifest(groups)])).toHaveLength(5)
  })
})

describe("remote-assets", () => {
  it("passes local fonts, assets and SVG namespaces", () => {
    const css = '@font-face { src: url("/fonts/Inter-Regular.woff2"); }'
    const tsx = file(
      "src/ui/shared/ui/flag/index.tsx",
      'export const F = () => <svg xmlns="http://www.w3.org/2000/svg" />\n',
    )
    expect(
      remoteAssets.run([module(css), tsx, file("index.html", '<script src="/src/main.tsx">')]),
    ).toEqual([])
  })

  it("reports CDN fonts, scripts, srcset and remote URLs in code", () => {
    const css = '@import "https://fonts.googleapis.com/css2?family=Inter";'
    const html =
      '<link href="https://cdn.example.com/x.css">\n<script src="//cdn.example.com/a.js">\n<img srcset="https://cdn.example.com/a.png 2x" alt="x" />'
    const tsx = file(
      "src/ui/features/x/index.tsx",
      'export const X = () => <img src="https://cdn.example.com/robot.png" alt="" />\nvoid new FontFace("p", "url(https://fonts.gstatic.com/p.woff2)")\n',
    )
    expect(remoteAssets.run([module(css), file("index.html", html), tsx])).toHaveLength(6)
  })
})

describe("accent-text", () => {
  it("passes teal as a surface", () => {
    expect(
      accentText.run([SEMANTIC, module(".a { background-color: var(--action-primary); }")]),
    ).toEqual([])
  })

  it("reports teal as text, also behind token and local aliases", () => {
    const css =
      ".a { color: var(--action-primary-hover); }\n.b { color: var(--text-accent); }\n.c { --c-ink: var(--action-primary); caret-color: var(--c-ink); }"
    expect(accentText.run([SEMANTIC, module(css)])).toHaveLength(3)
  })
})

describe("global-styles", () => {
  const global = file("src/ui/shared/styles/global.css", ":root {}")
  const main = (body: string) => file("src/main.tsx", body)

  it("passes one import of global.css from the entry", () => {
    expect(
      globalStyles.run([global, main('import "./ui/shared/styles/global.css"\n')]),
    ).toEqual([])
  })

  it("reports a missing entry import and imports from components", () => {
    const component = file(
      "src/ui/features/x/index.tsx",
      'import "../../shared/styles/global.css"\nexport const X = 1\n',
    )
    expect(globalStyles.run([global, main("export {}\n"), component])).toHaveLength(2)
  })
})
