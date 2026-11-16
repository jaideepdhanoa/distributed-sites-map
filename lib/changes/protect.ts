/** Banner shown on protected tabs. It is a note, not a cell value. */
export const PROTECT_BANNER = "Read-only — edit in distributedsites.com";

/** These tabs stay editable. Every other tab is a mirror. */
export const WRITABLE_SHEET_TITLES = ["Rules & Decisions", "Run Log"] as const;

export const PROTECT_CONFIRM = "protect-workbook-readonly";

export type SheetProtection = {
  sheetId: number;
  title: string;
  /** True when a protected range already covers the whole tab. */
  wholeSheet: boolean;
};

export type ProtectionTarget = { sheetId: number; title: string };

export type ProtectionPlan = {
  protect: ProtectionTarget[];
  note: ProtectionTarget[];
  writable: string[];
  already: string[];
  missingWritable: string[];
};

export function planSheetProtection(sheets: SheetProtection[]): ProtectionPlan {
  const titles = new Set(sheets.map((sheet) => sheet.title));
  const writable = WRITABLE_SHEET_TITLES.filter((title) => titles.has(title));
  const missingWritable = WRITABLE_SHEET_TITLES.filter((title) => !titles.has(title));
  const protect: ProtectionTarget[] = [];
  const already: ProtectionTarget[] = [];
  for (const sheet of sheets) {
    if ((WRITABLE_SHEET_TITLES as readonly string[]).includes(sheet.title)) continue;
    const target = { sheetId: sheet.sheetId, title: sheet.title };
    if (sheet.wholeSheet) already.push(target);
    else protect.push(target);
  }
  return {
    protect,
    note: [...protect, ...already],
    writable: [...writable],
    already: already.map((sheet) => sheet.title),
    missingWritable: [...missingWritable],
  };
}

export function formatProtectionPlan(plan: ProtectionPlan, mode: "dry-run" | "apply"): string {
  const list = (titles: string[]) => titles.join(", ") || "none";
  return [
    `mode ${mode}`,
    `protect ${plan.protect.length}: ${list(plan.protect.map((sheet) => sheet.title))}`,
    `already ${plan.already.length}: ${list(plan.already)}`,
    `writable ${list(plan.writable)}`,
    `missing_writable ${list(plan.missingWritable)}`,
    `banner ${PROTECT_BANNER}`,
    "Cell values are not changed. The note is set on A1 only.",
    mode === "apply" ? "This run will protect ranges." : "Nothing was written.",
  ].join("\n");
}

/** Dry run unless apply is exactly 1, dry is exactly 0, and the confirm phrase matches. */
export function protectionMode(input: { apply: string | undefined; dry: string | undefined; confirm: string | undefined }): "dry-run" | "apply" | "refuse" {
  const apply = input.apply === "1";
  const dry = input.dry !== "0";
  if (!apply || dry) return "dry-run";
  if ((input.confirm || "").trim() !== PROTECT_CONFIRM) return "refuse";
  return "apply";
}

/**
 * Whole-tab protection plus an A1 note. The note request sets `fields` to
 * `note`, so a filled cell, including a date, is not cleared or replaced.
 * The mirror account stays an editor. The request is not logged.
 */
export function protectionRequests(plan: ProtectionPlan, editorEmail: string): object[] {
  const requests: object[] = [];
  for (const sheet of plan.protect) {
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: sheet.sheetId },
          description: PROTECT_BANNER,
          warningOnly: false,
          editors: { users: [editorEmail] },
        },
      },
    });
  }
  for (const sheet of plan.note) {
    requests.push({
      updateCells: {
        range: {
          sheetId: sheet.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        rows: [{ values: [{ note: PROTECT_BANNER }] }],
        fields: "note",
      },
    });
  }
  return requests;
}
