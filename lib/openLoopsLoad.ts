import fs from "fs";
import path from "path";
import type { OpenLoopsSnapshot } from "./openLoops";
import { readGeneratedOptional } from "./snapshot/read";

export function loadOpenLoops(): OpenLoopsSnapshot {
  const generated = readGeneratedOptional("open-loops.json");
  if (generated) return generated as OpenLoopsSnapshot;
  const fixture = path.join(process.cwd(), "data", "fixtures", "open-loops.json");
  return JSON.parse(fs.readFileSync(fixture, "utf8")) as OpenLoopsSnapshot;
}
