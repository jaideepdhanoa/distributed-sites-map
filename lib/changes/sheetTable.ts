import { a1, columnLetters, sheetValueRender, type SheetRender, type SheetTable } from "./mirror";

/** One values:batchGet per render option. A site tab is the header, the unformatted columns, and the formulas. */
export const SHEET_READS_PER_SITE_TAB = 3;

/** Bounded retry for Sheets 429 and 5xx. The wait never grows past the cap. */
export const SHEETS_RETRY_ATTEMPTS = 6;

/** Read-back ranges per values:batchGet. One request covers a page of cells. */
export const READ_BACK_BATCH = 100;
export const SHEETS_RETRY_BASE_MS = 1000;
export const SHEETS_RETRY_MAX_DELAY_MS = 16_000;

export type SheetRead = (ranges: string[], kind: SheetRender) => Promise<string[][][]>;

export type SheetsRetryDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  baseMs?: number;
  maxDelayMs?: number;
};

type StoredRow = { cells: string[]; formulas: string[] };

function quoteSheet(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

function columnIndexes(headers: string[], fieldHeaders: string[][]): number[] {
  const wanted = new Set(fieldHeaders.flat().map((name) => name.trim().toLowerCase()));
  return headers
    .map((name, index) => ({ name, index }))
    .filter((column) => wanted.has(column.name.trim().toLowerCase()))
    .map((column) => column.index);
}

function columnRange(title: string, headerRow: number, index: number): string {
  const column = columnLetters(index + 1);
  return `${quoteSheet(title)}!${column}${headerRow + 1}:${column}`;
}

function absorbColumn(rows: Map<number, StoredRow>, index: number, headerRow: number, values: string[][], formulas: string[][]): void {
  values.forEach((line, offset) => {
    const rowNumber = headerRow + 1 + offset;
    const row = rows.get(rowNumber) || { cells: [], formulas: [] };
    row.cells[index] = line[0] || "";
    rows.set(rowNumber, row);
  });
  formulas.forEach((line, offset) => {
    const rowNumber = headerRow + 1 + offset;
    const row = rows.get(rowNumber) || { cells: [], formulas: [] };
    const formula = line[0] || "";
    if (formula.startsWith("=")) row.formulas[index] = formula;
    rows.set(rowNumber, row);
  });
}

function materialize(title: string, headerRow: number, headers: string[], rows: Map<number, StoredRow>): SheetTable {
  return {
    title,
    headerRow,
    headers,
    rows: [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, stored]) => ({ row, cells: stored.cells, formulas: stored.formulas })),
  };
}

async function headerAndIndexes(
  read: SheetRead,
  title: string,
  headerRow: number,
  fieldHeaders: string[][],
): Promise<{ headers: string[]; indexes: number[] }> {
  const header = (await read([`${quoteSheet(title)}!${headerRow}:${headerRow}`], "formatted"))[0] || [];
  const headers = header[0] || [];
  return { headers, indexes: columnIndexes(headers, fieldHeaders) };
}

/** The per-column reader. Tests compare it with the batched reader; the mirror does not call it. */
export async function loadSheetTablePerColumn(
  read: SheetRead,
  title: string,
  headerRow: number,
  fieldHeaders: string[][],
  siteCells = false,
): Promise<SheetTable> {
  const { headers, indexes } = await headerAndIndexes(read, title, headerRow, fieldHeaders);
  const rows = new Map<number, StoredRow>();
  for (const index of indexes) {
    const range = columnRange(title, headerRow, index);
    const values = (await read([range], siteCells ? "unformatted" : "formatted"))[0] || [];
    const formulas = siteCells ? (await read([range], "formulas"))[0] || [] : [];
    absorbColumn(rows, index, headerRow, values, formulas);
  }
  return materialize(title, headerRow, headers, rows);
}

/** All needed columns of one tab, one values:batchGet per render option. */
export async function loadSheetTable(
  read: SheetRead,
  title: string,
  headerRow: number,
  fieldHeaders: string[][],
  siteCells = false,
): Promise<SheetTable> {
  const { headers, indexes } = await headerAndIndexes(read, title, headerRow, fieldHeaders);
  const rows = new Map<number, StoredRow>();
  if (indexes.length) {
    const ranges = indexes.map((index) => columnRange(title, headerRow, index));
    const valueKind: SheetRender = siteCells ? "unformatted" : "formatted";
    const values = await read(ranges, valueKind);
    const formulas = siteCells ? await read(ranges, "formulas") : ranges.map(() => [] as string[][]);
    if (values.length !== ranges.length || formulas.length !== ranges.length) {
      throw new Error("Sheets read returned a different number of ranges than requested.");
    }
    indexes.forEach((index, position) => {
      absorbColumn(rows, index, headerRow, values[position] || [], formulas[position] || []);
    });
  }
  return materialize(title, headerRow, headers, rows);
}

function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Equal jitter inside the exponential cap. retryAfterMs can raise the wait, still never past the cap. */
export function sheetsRetryDelay(attempt: number, random: number, baseMs: number, maxDelayMs: number, retryAfterMs = 0): number {
  const exponential = Math.min(maxDelayMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const half = Math.floor(exponential / 2);
  const unit = Math.min(1, Math.max(0, random));
  const jittered = half + Math.floor(unit * (exponential - half));
  const after = Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0;
  return Math.min(maxDelayMs, Math.max(jittered, after));
}

function retryAfterMs(response: Response, maxDelayMs: number): number {
  const header = response.headers.get("retry-after");
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(maxDelayMs, Math.max(0, Math.round(seconds * 1000)));
  const when = Date.parse(header);
  if (Number.isNaN(when)) return 0;
  return Math.min(maxDelayMs, Math.max(0, when - Date.now()));
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel?.().catch(() => undefined);
}

export async function sheetsFetch(url: string, init: RequestInit = {}, deps: SheetsRetryDeps = {}): Promise<Response> {
  const fetchImpl = deps.fetch || fetch;
  const sleep = deps.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = deps.random || Math.random;
  const maxAttempts = deps.maxAttempts ?? SHEETS_RETRY_ATTEMPTS;
  const baseMs = deps.baseMs ?? SHEETS_RETRY_BASE_MS;
  const maxDelayMs = deps.maxDelayMs ?? SHEETS_RETRY_MAX_DELAY_MS;
  let last: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await fetchImpl(url, init);
    if (!retryableStatus(last.status) || attempt === maxAttempts) return last;
    const wait = sheetsRetryDelay(attempt, random(), baseMs, maxDelayMs, retryAfterMs(last, maxDelayMs));
    await discard(last);
    await sleep(wait);
  }
  if (!last) throw new Error("Sheets read failed (0) for a workbook range.");
  return last;
}

export function sheetBatchUrl(spreadsheetId: string, ranges: string[], kind: SheetRender): string {
  const params = new URLSearchParams();
  for (const range of ranges) params.append("ranges", range);
  const render = sheetValueRender(kind);
  if (render) params.set("valueRenderOption", render);
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params}`;
}

function gridFrom(value: unknown): string[][] {
  if (!value || typeof value !== "object") return [];
  const values = (value as { values?: unknown }).values;
  if (!Array.isArray(values)) return [];
  return values.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []));
}

export async function readSheetRanges(
  token: string,
  spreadsheetId: string,
  ranges: string[],
  kind: SheetRender,
  deps?: SheetsRetryDeps,
): Promise<string[][][]> {
  if (!ranges.length) return [];
  const response = await sheetsFetch(
    sheetBatchUrl(spreadsheetId, ranges, kind),
    { headers: { Authorization: `Bearer ${token}` } },
    deps,
  );
  if (!response.ok) throw new Error(`Sheets read failed (${response.status}) for a workbook range.`);
  let payload: { valueRanges?: unknown[] };
  try {
    payload = (await response.json()) as { valueRanges?: unknown[] };
  } catch {
    throw new Error(`Sheets read failed (${response.status}) for a workbook range.`);
  }
  const groups = payload.valueRanges || [];
  if (groups.length !== ranges.length) throw new Error("Sheets read returned a different number of ranges than requested.");
  return groups.map((group) => gridFrom(group));
}

export function isSheetsRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /\(429\)/.test(message);
}

/** A finished write stays succeeded when read-back is still rate limited. A mismatch fails. */
export function readBackOutcome(error: unknown): { status: "succeeded" | "failed"; note: string; rethrow: boolean } {
  if (isSheetsRateLimit(error)) {
    return { status: "succeeded", note: "wrote cells; read-back rate limited", rethrow: false };
  }
  return { status: "failed", note: "read-back mismatch", rethrow: true };
}

/** Read written cells with values:batchGet. 429 and 5xx retry inside readSheetRanges. */
export async function readBackCells(
  token: string,
  spreadsheetId: string,
  changes: { sheet: string; row: number; column: number }[],
  deps?: SheetsRetryDeps,
): Promise<{ sheet: string; row: number; column: number; value: string }[]> {
  const out: { sheet: string; row: number; column: number; value: string }[] = [];
  for (let start = 0; start < changes.length; start += READ_BACK_BATCH) {
    const chunk = changes.slice(start, start + READ_BACK_BATCH);
    const ranges = chunk.map((change) => a1(change.sheet, change.row, change.column));
    const grids = await readSheetRanges(token, spreadsheetId, ranges, "formatted", deps);
    chunk.forEach((change, index) => {
      const cell = grids[index]?.[0]?.[0];
      out.push({
        sheet: change.sheet,
        row: change.row,
        column: change.column,
        value: cell == null ? "" : cell,
      });
    });
  }
  return out;
}
