import fs from "fs";
import path from "path";
import type { OpenLoopsSnapshot } from "./openLoops";

export function loadOpenLoops(): OpenLoopsSnapshot {
  const generated = path.join(process.cwd(), "data", "generated", "open-loops.json");
  const fixture = path.join(process.cwd(), "data", "fixtures", "open-loops.json");
  const file = fs.existsSync(generated) ? generated : fixture;
  return JSON.parse(fs.readFileSync(file, "utf8")) as OpenLoopsSnapshot;
}
