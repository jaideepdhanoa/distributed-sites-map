import fs from "fs";
import path from "path";
import type { CommsSnapshot } from "./comms";
import { readGeneratedOptional } from "./snapshot/read";

export function loadCommsSnapshot(): CommsSnapshot {
  const generated = readGeneratedOptional("comms.json");
  if (generated) return generated as CommsSnapshot;
  const fixture = path.join(process.cwd(), "data", "fixtures", "comms.json");
  return JSON.parse(fs.readFileSync(fixture, "utf8")) as CommsSnapshot;
}
