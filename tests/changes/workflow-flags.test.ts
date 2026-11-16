import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const FLAGS = [
  ["READ_STAGES_FROM_DB", "vars.READ_STAGES_FROM_DB"],
  ["READ_ACTIVITY_FROM_DB", "vars.READ_ACTIVITY_FROM_DB"],
  ["READ_COMMS_FROM_DB", "vars.READ_COMMS_FROM_DB"],
  ["READ_SITES_FROM_DB", "vars.READ_SITES_FROM_DB"],
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

test("import and mirror steps receive the cutover flags", () => {
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
        if (key === "READ_SITES_FROM_DB") {
          assert.match(block, new RegExp(`^\\s+${key}:\\s*\\$\\{\\{`, "m"), `${file} runs ${script} without ${key}`);
          assert.match(block, /vars\.READ_SITES_FROM_DB\b/, `${file} runs ${script} without ${ref}`);
          continue;
        }
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

  const mirror = readFileSync(join(root, "workbook-mirror.yml"), "utf8");
  assert.match(mirror, /simulate_site_flag:\n\s+description: Dry run only\. Set READ_SITES_FROM_DB to 1 for this run\n\s+type: boolean\n\s+default: false/);
  assert.match(mirror, /simulate_site_flag is only allowed when dry_run is true/);
  assert.match(mirror, /SIMULATE_SITE_FLAG: \$\{\{ \(inputs\.simulate_site_flag == true \|\| inputs\.simulate_site_flag == 'true'\) && '1' \|\| '0' \}\}/);
  assert.match(
    mirror,
    /READ_SITES_FROM_DB: \$\{\{ \(inputs\.simulate_site_flag == true \|\| inputs\.simulate_site_flag == 'true'\) && \(inputs\.dry_run == true \|\| inputs\.dry_run == 'true'\) && '1' \|\| vars\.READ_SITES_FROM_DB \}\}/,
  );

  const protect = readFileSync(join(root, "workbook-protect.yml"), "utf8");
  assert.match(protect, /^name: Workbook protect/m);
  assert.match(protect, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(protect, /schedule:|pull_request:/);
  assert.match(protect, /dry_run:\n\s+description: Print the plan and do not change the workbook\n\s+type: boolean\n\s+default: true/);
  assert.match(protect, /apply:\n\s+description: Protect ranges\. Also set dry_run to false and type the confirm phrase\.\n\s+type: boolean\n\s+default: false/);
  assert.match(protect, /protect-workbook-readonly/);
  assert.match(protect, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(protect, /WORKBOOK_PROTECT_APPLY: \$\{\{ \(inputs\.apply == true \|\| inputs\.apply == 'true'\) && \(inputs\.dry_run == false \|\| inputs\.dry_run == 'false'\) && '1' \|\| '0' \}\}/);
  assert.match(protect, /Rules & Decisions and Run Log stay writable/);
  assert.doesNotMatch(protect, /NEON_DATABASE_URL/);

  const sync = readFileSync(join(root, "workbook-sync.yml"), "utf8");
  const importStep = stepBlocks(sync).find((block) => block.includes("scripts/import-shadow.ts"));
  assert.ok(importStep);
  assert.match(importStep, /Report workbook drift/);
  assert.doesNotMatch(importStep, /importChanged|WORKBOOK_IMPORT_APPLY/);
});
