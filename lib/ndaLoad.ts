import fs from "fs";
import path from "path";
import type { NdaSnapshot } from "./nda";

export function loadNdaSnapshot(): NdaSnapshot {
  const generated = path.join(process.cwd(), "data", "generated", "nda.json");
  const fixture = path.join(process.cwd(), "data", "fixtures", "nda.json");
  const file = fs.existsSync(generated) ? generated : fixture;
  return JSON.parse(fs.readFileSync(file, "utf8")) as NdaSnapshot;
}
