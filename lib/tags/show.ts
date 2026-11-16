import { dealRecord, mapTags, type TagView } from "./map";
import { tagFamily } from "./vocab";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/** Derived chips for a deal that has not been painted by the database yet. */
export function chipsFromDeal(props: Record<string, unknown>, signedIn: boolean): TagView[] {
  const record = dealRecord(props as Parameters<typeof dealRecord>[0]);
  record.stageReason = text(props.stage_reason);
  return presentChips(mapTags(record).chips, signedIn);
}

export function presentChips(chips: TagView[], signedIn: boolean): TagView[] {
  return chips
    .filter((chip) => signedIn || !tagFamily(chip.family)?.signedIn)
    .map((chip) => (signedIn ? chip : { ...chip, note: "" }));
}
