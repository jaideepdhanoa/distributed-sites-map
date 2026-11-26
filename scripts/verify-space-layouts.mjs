import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function verifySpaceLayouts(origin, file, credentials) {
  if (!credentials.username || !credentials.password) throw Error("The signed-in release check requires its existing E2E account.");
  const login = await fetch(new URL("/api/login", origin), {
    method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(30000),
  });
  if (!login.ok) throw Error("The release check could not sign in.");
  const cookie = login.headers.getSetCookie().map(line => line.split(";")[0]).join("; ");
  if (!cookie) throw Error("The release check did not receive a session.");
  const read = path => fetch(new URL(path, origin), { redirect: "error", headers: { cookie }, signal: AbortSignal.timeout(25000) });
  const sites = Object.entries(file.sites);
  if (!sites.length || file.version !== 1) throw Error("The assessment source is empty or unsupported.");
  const check = async ([site, row]) => {
    const reply = await read("/api/data/space-options?" + new URLSearchParams({ site }));
    if (!reply.ok) return false;
    const { assessment } = await reply.json();
    if (assessment?.reviewedOn !== file.reviewedOn || !isDeepStrictEqual(assessment.row, row)) return false;
    const src = row.image?.src;
    if (!src || src.startsWith("data:image/webp;base64,")) return true;
    if (!/^\/api\/data\/photos\/[a-f0-9]{20}\.(jpeg|jpg|png|webp)$/.test(src)) return false;
    const image = await read(src);
    const valid = image.ok && (image.headers.get("content-type") || "").startsWith("image/") && (await image.arrayBuffer()).byteLength > 0;
    return valid;
  };
  // A cache refresh may briefly serve the previous snapshot. Retry only unresolved records.
  let remaining = sites;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await pause(15000 * attempt);
    const unresolved = [];
    for (let i = 0; i < remaining.length; i += 4) {
      const group = remaining.slice(i, i + 4);
      const passed = await Promise.all(group.map(entry => check(entry).catch(() => false)));
      unresolved.push(...group.filter((_, j) => !passed[j]));
    }
    if (!unresolved.length) {
      const portfolioResponse = await read("/api/data/space-options?view=portfolio");
      if (!portfolioResponse.ok) throw Error("Production portfolio readback failed.");
      const portfolio = await portfolioResponse.json();
      const visible = new Set((portfolio.rows || []).map(row => row.id));
      if (!sites.every(([site]) => visible.has(site))) throw Error("The portfolio is missing assessment records.");
      return sites.length;
    }
    remaining = unresolved;
  }
  throw Error("Production assessment or aerial readback unresolved for " + remaining.length + " of " + sites.length + " records.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = JSON.parse(await readFile("data/generated/space-layouts.json", "utf8"));
  const count = await verifySpaceLayouts("https://distributedsites.com", file, { username: process.env.E2E_USERNAME, password: process.env.E2E_PASSWORD });
  const message = "Verified " + count + " signed-in site assessments and their filed aerial images.";
  console.log(message);
  await writeFile(".space-layouts-readback", message + "\n");
}
