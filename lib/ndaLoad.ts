import fs from "fs";
import path from "path";
import type { NdaSnapshot } from "./nda";
import { readGeneratedOptional } from "./snapshot/read";

export function loadNdaSnapshot(): NdaSnapshot {
  const generated = readGeneratedOptional("nda.json");
  if (generated) return generated as NdaSnapshot;
  const fixture = path.join(process.cwd(), "data", "fixtures", "nda.json");
  return JSON.parse(fs.readFileSync(fixture, "utf8")) as NdaSnapshot;
}
