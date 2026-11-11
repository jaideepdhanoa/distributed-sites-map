import fs from "fs";
import path from "path";
import type { CommsSnapshot } from "./comms";

export function loadCommsSnapshot(): CommsSnapshot {
  const generated = path.join(process.cwd(), "data", "generated", "comms.json");
  const fixture = path.join(process.cwd(), "data", "fixtures", "comms.json");
  const file = fs.existsSync(generated) ? generated : fixture;
  return JSON.parse(fs.readFileSync(file, "utf8")) as CommsSnapshot;
}
