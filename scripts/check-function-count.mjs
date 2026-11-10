import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Hobby allows 12 Serverless Functions. Fail at 10 so a new route still fits.
const LIMIT = 10;
const root = path.join(process.cwd(), ".vercel", "output", "functions");

function functions(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    console.error(`No Vercel build output at ${root}. Run \`npx vercel build --yes\` first.`);
    process.exit(1);
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    const configPath = path.join(full, ".vc-config.json");
    try {
      if (statSync(configPath).isFile()) {
        const config = JSON.parse(readFileSync(configPath, "utf8"));
        const runtime = String(config.runtime || "");
        if (runtime.startsWith("nodejs")) found.push({ path: path.relative(root, full), runtime });
        continue;
      }
    } catch {
      // Not a function directory.
    }
    functions(full, found);
  }
  return found;
}

const found = functions(root).sort((a, b) => a.path.localeCompare(b.path));
console.log(`${found.length} Node.js functions (limit ${LIMIT}):`);
for (const item of found) console.log(`  ${item.runtime}  ${item.path}`);
if (found.length > LIMIT) {
  console.error(`Function count ${found.length} exceeds ${LIMIT}. Add the route to app/api/[...route] instead of a new route file.`);
  process.exit(1);
}
