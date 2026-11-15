import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { unpackFile } from "./pack";
import { selectLiveBundle, type SnapshotBundle } from "./store";

export const SNAPSHOT_TAG = "snapshot";
const REVALIDATE_SECONDS = 300;

type Memory = {
  id: string;
  createdAt: string;
  files: Record<string, string>;
};

let memory: Memory | null = null;
let generation = 0;
let installedForTests = false;
let directUntil = 0;
let directBundle: SnapshotBundle | null | undefined;

export function snapshotGeneration(): number {
  return generation;
}

export function snapshotReadFlagOff(): boolean {
  const flag = process.env.SNAPSHOT_READ?.trim().toLowerCase();
  return flag === "off" || flag === "0" || flag === "false";
}

function clearMemory(): void {
  if (!memory) return;
  memory = null;
  generation += 1;
}

export function installSnapshotForTests(next: Memory | null): void {
  installedForTests = next !== null;
  memory = next;
  generation += 1;
}

export function resetSnapshotForTests(): void {
  installedForTests = false;
  memory = null;
  directBundle = undefined;
  directUntil = 0;
  generation += 1;
}

export function currentSnapshotMeta(): { id: string; createdAt: string } | null {
  if (snapshotReadFlagOff() || !memory) return null;
  return { id: memory.id, createdAt: memory.createdAt };
}

export function snapshotStatus(): {
  snapshot_id: string | null;
  snapshot_created_at: string | null;
  snapshot_source: "database" | "files";
} {
  const meta = currentSnapshotMeta();
  if (!meta) {
    return { snapshot_id: null, snapshot_created_at: null, snapshot_source: "files" };
  }
  return { snapshot_id: meta.id, snapshot_created_at: meta.createdAt, snapshot_source: "database" };
}

export function snapshotHas(name: string): boolean {
  if (snapshotReadFlagOff()) return false;
  return Boolean(memory && Object.prototype.hasOwnProperty.call(memory.files, name));
}

function diskText(name: string): string {
  return readFileSync(path.join(process.cwd(), "data", "generated", name), "utf8");
}

export function readGeneratedText(name: string): string {
  if (name === "site_sheet.json" || name === "comms_full.json") {
    throw new Error(`${name} is not a public snapshot file.`);
  }
  if (!snapshotReadFlagOff() && memory && Object.prototype.hasOwnProperty.call(memory.files, name)) {
    return memory.files[name];
  }
  return diskText(name);
}

export function readGenerated(name: string): unknown {
  return JSON.parse(readGeneratedText(name)) as unknown;
}

export function readGeneratedOptional(name: string): unknown | undefined {
  try {
    if (snapshotHas(name) || diskExists(name)) return readGenerated(name);
  } catch {
    return undefined;
  }
  return undefined;
}

function diskExists(name: string): boolean {
  return existsSync(path.join(process.cwd(), "data", "generated", name));
}

function remember(bundle: SnapshotBundle | null): void {
  if (!bundle) {
    clearMemory();
    return;
  }
  if (memory && memory.id === bundle.id) return;
  const files: Record<string, string> = {};
  for (const [name, packed] of Object.entries(bundle.files)) {
    if (name === "site_sheet.json" || name === "comms_full.json") continue;
    files[name] = unpackFile(packed);
  }
  memory = { id: bundle.id, createdAt: bundle.createdAt, files };
  generation += 1;
}

async function readLiveBundleFromPool(): Promise<SnapshotBundle | null> {
  return withSql((sql) => selectLiveBundle(sql));
}

let cachedLoad: (() => Promise<SnapshotBundle | null>) | null = null;

async function loadCachedBundle(): Promise<SnapshotBundle | null> {
  if (directBundle !== undefined && directUntil > Date.now()) return directBundle;
  try {
    if (!cachedLoad) {
      const { unstable_cache } = await import("next/cache");
      cachedLoad = unstable_cache(readLiveBundleFromPool, ["snapshot-live-bundle"], {
        revalidate: REVALIDATE_SECONDS,
        tags: [SNAPSHOT_TAG],
      });
    }
    const bundle = await cachedLoad();
    directBundle = undefined;
    directUntil = 0;
    return bundle;
  } catch {
    console.error(JSON.stringify({ event: "snapshot_cache_bypass" }));
    const bundle = await readLiveBundleFromPool();
    directBundle = bundle;
    directUntil = Date.now() + REVALIDATE_SECONDS * 1000;
    return bundle;
  }
}

export async function primeSnapshot(): Promise<void> {
  if (installedForTests) return;
  if (snapshotReadFlagOff()) {
    clearMemory();
    return;
  }
  if (!actionsEnabled()) return;
  try {
    await whenReady(() => withSql(async (sql) => {
      await migrate(sql);
    }));
    remember(await loadCachedBundle());
  } catch {
    console.error(JSON.stringify({ event: "snapshot_read_fallback" }));
    clearMemory();
  }
}

export async function revalidateSnapshotCache(): Promise<void> {
  directBundle = undefined;
  directUntil = 0;
  if (!installedForTests) clearMemory();
  const { revalidateTag } = await import("next/cache");
  revalidateTag(SNAPSHOT_TAG, { expire: 0 });
}
