import { copyFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, "..", "context", "mvp", "examples")
const target = join(root, "src", "adapters", "fixture", "examples")

for (const name of [
  "state-idle.json",
  "state-running.json",
  "state-team-partial.json",
  "state-slam-running.json",
  "map.json",
  "journal.json",
  "error.json",
]) {
  copyFileSync(join(source, name), join(target, name))
}
process.stdout.write(`Examples synced${"\n"}`)
