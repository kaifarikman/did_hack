// Копирует общие контрактные примеры в frontend, чтобы Docker-сборка не зависела от context/.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "..", "context", "mvp", "examples");
const target = join(root, "src", "adapters", "fixture", "examples");

for (const name of ["state-idle.json", "state-running.json", "map.json", "journal.json", "error.json"]) {
  copyFileSync(join(source, name), join(target, name));
}
console.log("Примеры синхронизированы");
