import { dealRecord, dropReasonCode, mapTags, type TagView } from "./map";
import { tagCode, tagFamily } from "./vocab";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asChips(value: unknown): TagView[] {
  if (!Array.isArray(value)) return [];
  return value.filter((chip): chip is TagView => {
    if (!chip || typeof chip !== "object") return false;
    const row = chip as TagView;
    return typeof row.family === "string" && typeof row.code === "string" && typeof row.label === "string";
  });
}

/** Derived chips for a deal that has not been painted by the database yet. */
export function chipsFromDeal(props: Record<string, unknown>, signedIn: boolean): TagView[] {
  const record = dealRecord(props as Parameters<typeof dealRecord>[0]);
  record.stageReason = text(props.stage_reason);
  return presentChips(mapTags(record).chips, signedIn);
}

/** Stored tags replace the derived chip for that family. An empty tag table keeps the derived set. */
export function chipsForDeal(props: Record<string, unknown>, signedIn: boolean): TagView[] {
  const derived = chipsFromDeal(props, signedIn);
  const byFamily = new Map(derived.map((chip) => [chip.family, chip]));
  for (const chip of asChips(props.chips)) {
    if (!signedIn && tagFamily(chip.family)?.signedIn) continue;
    byFamily.set(chip.family, signedIn ? chip : { ...chip, note: "" });
  }
  return [...byFamily.values()];
}

/** A suggested drop becomes the short drop-reason chip. Unmapped text stays off the cell. */
export function suggestedDropChip(reason: string): TagView | null {
  const code = dropReasonCode(reason);
  const item = code ? tagCode("drop_reason", code) : null;
  if (!item || !code) return null;
  return {
    family: "drop_reason",
    code,
    label: item.label,
    tone: item.tone,
    help: item.help,
    since: "",
    note: "",
    owner: "",
    due: "",
    source: "suggested_drop",
  };
}

export function presentChips(chips: TagView[], signedIn: boolean): TagView[] {
  return chips
    .filter((chip) => signedIn || !tagFamily(chip.family)?.signedIn)
    .map((chip) => (signedIn ? chip : { ...chip, note: "" }));
}
