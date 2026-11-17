import { parseAmount } from "./money";
import { buildStatement, type CapturedLine, type MissingMonth, type PnlStatement } from "./statement";

const CAPTURED = "2026-03-01T15:00:00-07:00";

function line(partial: Omit<CapturedLine, "amount" | "sourceDocument" | "sourceHref" | "capturedAt"> & { amount: string; sourceDocument?: string; sourceHref?: string; capturedAt?: string }): CapturedLine {
  const amount = parseAmount(partial.amount);
  if (!amount) throw new Error("Sample amount is not a captured number.");
  return {
    ...partial,
    amount,
    sourceDocument: partial.sourceDocument || "Sample package",
    sourceHref: partial.sourceHref || "",
    capturedAt: partial.capturedAt || CAPTURED,
  };
}

/** Synthetic statement for the signed-in preview. These figures are not a site. */
export function sampleStatement(): PnlStatement {
  const lines: CapturedLine[] = [
    line({ id: "PL-900001", periodId: "PP-900001", grain: "annual", year: 2024, month: null, throughMonth: null, business: "car_wash", code: "revenue", amount: "1000000", status: "reported", sourcePage: "Sheet 2024" }),
    line({ id: "PL-900002", periodId: "PP-900001", grain: "annual", year: 2024, month: null, throughMonth: null, business: "car_wash", code: "labor", amount: "500000", status: "reported", sourcePage: "Sheet 2024" }),
    line({ id: "PL-900003", periodId: "PP-900001", grain: "annual", year: 2024, month: null, throughMonth: null, business: "car_wash", code: "chemicals", amount: "60000", status: "reported", sourcePage: "Sheet 2024" }),
    line({ id: "PL-900004", periodId: "PP-900001", grain: "annual", year: 2024, month: null, throughMonth: null, business: "car_wash", code: "addback_owner_pay", amount: "80000", status: "estimated", sourceDocument: "Sample notes", sourcePage: "Note 2" }),
    line({ id: "PL-900009", periodId: "PP-900001", grain: "annual", year: 2024, month: null, throughMonth: null, business: "car_wash", code: "labor", amount: "450000", status: "normalized", sourcePage: "Sheet 2024 normalized" }),
    line({ id: "PL-900005", periodId: "PP-900002", grain: "monthly", year: 2024, month: 1, throughMonth: null, business: "car_wash", code: "revenue", amount: "80000", status: "reported", sourcePage: "Jan" }),
    line({ id: "PL-900006", periodId: "PP-900002", grain: "monthly", year: 2024, month: 1, throughMonth: null, business: "car_wash", code: "labor", amount: "10000", status: "reported", sourcePage: "Jan", sourceHref: "https://drive.google.com/file/d/FixtureDriveFileId0000000001/view" }),
    line({ id: "PL-900007", periodId: "PP-900003", grain: "monthly", year: 2024, month: 3, throughMonth: null, business: "car_wash", code: "revenue", amount: "90000", status: "reported", sourcePage: "Mar" }),
    line({ id: "PL-900008", periodId: "PP-900003", grain: "monthly", year: 2024, month: 3, throughMonth: null, business: "car_wash", code: "chemicals", amount: "12000", status: "reported", sourcePage: "Mar" }),
  ];
  return buildStatement(lines, [{
    year: 2024,
    month: 2,
    business: "car_wash",
    periodId: "PP-900009",
    sourceDocument: "Sample package",
    sourcePage: "Month index",
    capturedAt: CAPTURED,
  }]);
}

/**
 * Display twin of the stored missing-month rows. The rows themselves are
 * inserted by `insertMissingMonthShape`: null line code, status missing,
 * and period.missing true. Amounts here are samples.
 */
export function gapStatement(): PnlStatement {
  const lines: CapturedLine[] = [];
  function add(id: string, periodId: string, year: number, month: number, code: "revenue" | "labor", raw: string) {
    const amount = parseAmount(raw);
    if (!amount) throw new Error("Sample amount is not a captured number.");
    lines.push({
      id,
      periodId,
      grain: "monthly",
      year,
      month,
      throughMonth: null,
      business: "car_wash",
      code,
      amount,
      status: "reported",
      sourceDocument: "Sample package",
      sourcePage: String(month),
      sourceHref: "",
      capturedAt: CAPTURED,
    });
  }
  for (const month of [1, 2, 3, 4, 6, 7]) {
    add(`PL-r-${month}`, `PP-m-${month}`, 2026, month, "revenue", "10000");
    add(`PL-l-${month}`, `PP-m-${month}`, 2026, month, "labor", "2000");
  }
  const annualRevenue = parseAmount("90000");
  const annualLabor = parseAmount("30000");
  if (!annualRevenue || !annualLabor) throw new Error("Sample amount is not a captured number.");
  lines.push(
    {
      id: "PL-range-r",
      periodId: "PP-range",
      grain: "annual",
      year: 2026,
      month: null,
      throughMonth: 7,
      business: "car_wash",
      code: "revenue",
      amount: annualRevenue,
      status: "reported",
      sourceDocument: "Sample package",
      sourcePage: "Range",
      sourceHref: "",
      capturedAt: CAPTURED,
    },
    {
      id: "PL-range-l",
      periodId: "PP-range",
      grain: "annual",
      year: 2026,
      month: null,
      throughMonth: 7,
      business: "car_wash",
      code: "labor",
      amount: annualLabor,
      status: "reported",
      sourceDocument: "Sample package",
      sourcePage: "Range",
      sourceHref: "",
      capturedAt: CAPTURED,
    },
  );
  const missing: MissingMonth[] = [
    {
      year: 2025,
      month: 4,
      business: "car_wash",
      periodId: "PP-000095",
      sourceDocument: "Sample package. Stand-in for the missing month.",
      sourcePage: "Month index",
      capturedAt: CAPTURED,
      markerSource: "Not in package",
    },
    {
      year: 2026,
      month: 5,
      business: "car_wash",
      periodId: "PP-000096",
      sourceDocument: "Sample package. Stand-in for the missing month.",
      sourcePage: "Month index",
      capturedAt: CAPTURED,
      markerSource: "Not in package",
    },
  ];
  return buildStatement(lines, missing);
}

const MEASURED_DOCUMENT = "Sample package. Stand-in for the missing month.";

/**
 * The statement shape read for a site that has a Jan–Jul range, a full prior
 * year, and two missing months. Amounts are samples. The document name is a
 * stand-in of the same length as the stored one.
 */
export function measuredStatement(): PnlStatement {
  const captured = "2026-11-16T12:00:00Z";
  const lines: CapturedLine[] = [];
  function add(
    id: string,
    periodId: string,
    year: number,
    grain: "annual" | "monthly",
    month: number | null,
    throughMonth: number | null,
    code: "revenue" | "labor",
    raw: string,
    page: string,
  ) {
    const amount = parseAmount(raw);
    if (!amount) throw new Error("Sample amount is not a captured number.");
    lines.push({
      id,
      periodId,
      grain,
      year,
      month,
      throughMonth,
      business: "car_wash",
      code,
      amount,
      status: "reported",
      sourceDocument: "Sample package",
      sourcePage: page,
      sourceHref: "",
      capturedAt: captured,
    });
  }
  for (const month of [1, 2, 3, 4, 6, 7]) {
    add(`PL-m-${month}-r`, `PP-m-${month}`, 2026, "monthly", month, null, "revenue", "10000", String(month));
    add(`PL-m-${month}-l`, `PP-m-${month}`, 2026, "monthly", month, null, "labor", "2000", String(month));
  }
  add("PL-range-r", "PP-S-RANGE", 2026, "annual", null, 7, "revenue", "90000", "Range");
  add("PL-range-l", "PP-S-RANGE", 2026, "annual", null, 7, "labor", "30000", "Range");
  add("PL-2025-r", "PP-S-2025", 2025, "annual", null, null, "revenue", "80000", "2025");
  add("PL-2025-l", "PP-S-2025", 2025, "annual", null, null, "labor", "24000", "2025");
  return buildStatement(lines, [
    {
      year: 2026,
      month: 5,
      business: "car_wash",
      periodId: "PP-S-MAY",
      sourceDocument: MEASURED_DOCUMENT,
      sourcePage: "Month index",
      capturedAt: captured,
      markerSource: "Not in package",
    },
    {
      year: 2025,
      month: 4,
      business: "car_wash",
      periodId: "PP-S-APR",
      sourceDocument: MEASURED_DOCUMENT,
      sourcePage: "Month index",
      capturedAt: captured,
      markerSource: "Not in package",
    },
  ]);
}
