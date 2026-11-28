import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function signedInReleaseReader(origin, credentials) {
  if (!credentials.username || !credentials.password) throw Error("The signed-in release check requires its existing E2E account.");
  const login = await fetch(new URL("/api/login", origin), {
    method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(30000),
  });
  if (!login.ok) throw Error("The release check could not sign in.");
  const cookie = login.headers.getSetCookie().map(line => line.split(";")[0]).join("; ");
  if (!cookie) throw Error("The release check did not receive a session.");
  return path => fetch(new URL(path, origin), { redirect: "error", headers: { cookie }, signal: AbortSignal.timeout(25000) });
}

export async function verifySpaceLayouts(origin, file, credentials) {
  const read = await signedInReleaseReader(origin, credentials);
  const sites = Object.entries(file.sites);
  if (!sites.length || file.version !== 1) throw Error("The assessment source is empty or unsupported.");
  const check = async ([site, row]) => {
    const reply = await read("/api/data/space-options?" + new URLSearchParams({ site }));
    if (!reply.ok) return false;
    const { assessment } = await reply.json();
    if (assessment?.reviewedOn !== (row.reviewedOn ?? file.reviewedOn) || !isDeepStrictEqual(assessment.row, row)) return false;
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
      const [dealsReply,mapReply] = await Promise.all([read("/api/data/deals"),read("/api/data/space-options?view=map")]);
      if (!dealsReply.ok || !mapReply.ok) throw Error("Could not read the published layout and cost screens.");
      const [deals,catalog]=await Promise.all([dealsReply.json(),mapReply.json()]);
      if (!catalog.reviewsAvailable) throw Error("The current map outlines are unavailable.");
      const records=new Map(deals.features.map(f=>[f.properties.deal_id,f.properties]));
      let recommendations=0, assessedSites=0, activeSites=0, activeAssessed=0;
      for (const site of catalog.sites) {
        if (site.assessed) { assessedSites++; recommendations+=site.assessed.combinations; }
        const record=records.get(site.id);
        if (!record || record.kind!=="pipeline") continue;
        if (site.cohort==="active") { activeSites++; if (site.assessed) activeAssessed++; }
        const layouts=record.chargingSpace?.layouts || [];
        const system=layouts.filter(l=>l.system);
        if (system.length!==(site.assessed?.combinations??0)) throw Error("The map and pipeline disagree on the number of recommendations.");
        if (site.assessed && (site.assessed.stalls!==system[0].stalls || record.chargingSpace.count!==system[0].stalls ||
            site.assessed.maximum!==Math.max(...system.map(l=>l.stalls)) ||
            system.some(l=>l.stalls!==l.parts.reduce((n,p)=>n+p.stalls,0)))) throw Error("The pipeline and map disagree on a recommended combination.");
        const filed=file.sites[site.id]?.parcelCases;
        if (filed?.length && !site.zones.some(z=>z.edited || z.useRight?.status==="unavailable")) {
          const original=layouts.filter(l=>l.parcel && !l.system);
          if (!isDeepStrictEqual(original.map(l=>l.stalls),filed.map(c=>c.rows.reduce((n,r)=>n+r.count,0))))
            throw Error("The pipeline does not match its filed parcel layouts.");
        }
        const priced=record.charging?.preliminary;
        if (system.length && priced && "layouts" in priced) {
          if (!isDeepStrictEqual(priced.layouts.map(l=>[l.mixId,l.stalls,l.condition]).sort(),layouts.map(l=>[l.mixId,l.stalls,l.condition]).sort()))
            throw Error("The charging explanation and parcel geometries disagree.");
          const rate=priced.layouts[0].base.sessions/priced.layouts[0].stalls;
          if (priced.layouts.some(l=>Math.abs(l.base.sessions/l.stalls-rate)>1e-6))
            throw Error("Utilization differs between the assessed combinations.");
        }
      }
      console.log("Published layout readback:",recommendations,"system combinations across",assessedSites,"mapped assessments;",activeAssessed,"of",activeSites,"mapped active records with source outlines.");
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
