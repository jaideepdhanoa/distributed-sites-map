import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const FLAGS = [
  ["READ_STAGES_FROM_DB", "vars.READ_STAGES_FROM_DB"],
  ["READ_ACTIVITY_FROM_DB", "vars.READ_ACTIVITY_FROM_DB"],
  ["READ_COMMS_FROM_DB", "vars.READ_COMMS_FROM_DB"],
  ["CHANGES_API_ENABLED", "vars.CHANGES_API_ENABLED"],
] as const;

const SCRIPTS = ["scripts/import-shadow.ts", "scripts/workbook-mirror.ts"] as const;

function stepBlocks(yaml: string): string[] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of yaml.split("\n")) {
    if (/^ {6}- /.test(line)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks.map((block) => block.join("\n"));
}

test("import and mirror steps receive the four cutover flags", () => {
  const root = join(process.cwd(), ".github", "workflows");
  const hits: { file: string; script: string }[] = [];
  for (const file of readdirSync(root)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const yaml = readFileSync(join(root, file), "utf8");
    for (const block of stepBlocks(yaml)) {
      const script = SCRIPTS.find((name) => block.includes(name));
      if (!script) continue;
      hits.push({ file, script });
      for (const [key, ref] of FLAGS) {
        assert.match(
          block,
          new RegExp(`^\\s+${key}:\\s*\\$\\{\\{\\s*${ref}\\b`, "m"),
          `${file} runs ${script} without ${key} from ${ref}`,
        );
      }
    }
  }
  assert.ok(hits.some((hit) => hit.script === "scripts/import-shadow.ts"), "no step runs the shadow import");
  assert.ok(hits.some((hit) => hit.script === "scripts/workbook-mirror.ts"), "no step runs the workbook mirror");

  const manual = readFileSync(join(root, "shadow-import.yml"), "utf8");
  assert.match(manual, /^name: Shadow import/m);
  assert.match(manual, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(manual, /schedule:|pull_request:/);
  assert.match(manual, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(manual, /NEON_DATABASE_URL: \$\{\{ secrets\.NEON_DATABASE_URL \}\}/);
  assert.match(manual, /NEON_PRODUCTION_HOST: \$\{\{ vars\.NEON_PRODUCTION_HOST \}\}/);
  assert.ok(hits.some((hit) => hit.file === "shadow-import.yml" && hit.script === "scripts/import-shadow.ts"));
});
