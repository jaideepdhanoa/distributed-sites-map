export type EnvRecord = {
  id: string;
  key: string;
  target: string[];
};

export type EnvWrite = {
  key: string;
  target: ["preview"];
};

export type EnvNarrow = {
  id: string;
  key: string;
  target: string[];
};

export type EnvPlan = {
  narrow: EnvNarrow[];
  write: EnvWrite[];
};

/** Connection and host variables the reset job may retarget onto Preview. */
export const PREVIEW_DB_KEYS = [
  "DATABASE_URL",
  "NEON_DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NO_SSL",
  "DATABASE_URL_UNPOOLED",
  "PGHOST",
  "POSTGRES_HOST",
  "PGHOST_UNPOOLED",
  "PGUSER",
  "POSTGRES_USER",
  "PGPASSWORD",
  "POSTGRES_PASSWORD",
  "PGDATABASE",
  "POSTGRES_DATABASE",
  "NEON_PRODUCTION_HOST",
  "PREVIEW_DATABASE_BRANCH",
] as const;

const MANAGED = new Set<string>(PREVIEW_DB_KEYS);

/** Always set on Preview, even when the key is missing there today. */
export const ALWAYS_PREVIEW_KEYS = ["DATABASE_URL", "NEON_PRODUCTION_HOST", "PREVIEW_DATABASE_BRANCH"] as const;

const KEPT_TARGETS = new Set(["production", "development"]);

const WRITE_FIRST = ["DATABASE_URL", "NEON_PRODUCTION_HOST"] as const;
const WRITE_LAST = "PREVIEW_DATABASE_BRANCH";

/** URL and production host are written before the preview marker. */
export function orderPreviewWrites(keys: readonly string[]): string[] {
  const present = new Set(keys);
  const ordered: string[] = [];
  for (const key of WRITE_FIRST) {
    if (present.has(key)) ordered.push(key);
  }
  const first = new Set<string>(WRITE_FIRST);
  const middle = [...present].filter((key) => !first.has(key) && key !== WRITE_LAST).sort();
  ordered.push(...middle);
  if (present.has(WRITE_LAST)) ordered.push(WRITE_LAST);
  return ordered;
}

export function keysForPreviewSplit(records: readonly EnvRecord[]): string[] {
  const keys = new Set<string>(ALWAYS_PREVIEW_KEYS);
  for (const record of records) {
    if (!MANAGED.has(record.key)) continue;
    if (record.target.includes("preview")) keys.add(record.key);
  }
  return orderPreviewWrites([...keys]);
}

function assertKeptTargets(key: string, targets: readonly string[]): void {
  for (const target of targets) {
    if (!KEPT_TARGETS.has(target)) {
      throw new Error(`Refusing to edit ${key} because its target is not production or development.`);
    }
  }
}

/**
 * Remove Preview from any shared variable, then write a Preview-only value.
 * A shared variable keeps production and development. The new value is never
 * written onto a target that includes production.
 */
export function planPreviewEnv(records: readonly EnvRecord[], keys: readonly string[]): EnvPlan {
  const narrow: EnvNarrow[] = [];
  const write: EnvWrite[] = [];
  for (const key of keys) {
    if (!MANAGED.has(key)) throw new Error(`Refusing to change ${key} from the preview database workflow.`);
    for (const record of records) {
      if (record.key !== key || !record.target.includes("preview")) continue;
      const rest = record.target.filter((target) => target !== "preview");
      if (!rest.length) continue;
      assertKeptTargets(key, rest);
      for (const target of rest) {
        if (!record.target.includes(target)) throw new Error(`Refusing to add a target on ${key}.`);
      }
      narrow.push({ id: record.id, key, target: rest });
    }
    write.push({ key, target: ["preview"] });
  }
  for (const step of narrow) {
    if (step.target.includes("preview")) throw new Error("Refusing to leave Preview on a shared env var.");
    if (!step.target.length) throw new Error("Refusing to clear every target on a shared env var.");
  }
  for (const step of write) {
    if (step.target.length !== 1 || step.target[0] !== "preview") {
      throw new Error("Refusing to write an env var outside the Preview target.");
    }
  }
  return { narrow, write };
}

export function recordsAfterNarrow(records: readonly EnvRecord[], plan: EnvPlan): EnvRecord[] {
  const next = new Map(plan.narrow.map((step) => [step.id, step.target]));
  return records.map((record) => (next.has(record.id) ? { ...record, target: [...(next.get(record.id) || [])] } : record));
}

/** True when a later write could change a variable that still includes production. */
export function sharedPreviewStillAttached(records: readonly EnvRecord[], key: string): boolean {
  return records.some((record) => record.key === key && record.target.includes("preview") && record.target.some((target) => target !== "preview"));
}

export function narrowBody(target: readonly string[]): { target: string[] } {
  if (target.includes("preview")) throw new Error("Refusing to leave Preview on a shared env var.");
  if (!target.length) throw new Error("Refusing to clear every target on a shared env var.");
  return { target: [...target] };
}

export function previewWriteBody(key: string, value: string, type: "sensitive" | "plain"): {
  key: string;
  value: string;
  type: "sensitive" | "plain";
  target: ["preview"];
} {
  return { key, value, type, target: ["preview"] };
}
