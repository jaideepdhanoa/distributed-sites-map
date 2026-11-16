import { parseAmount } from "./money";
import { buildStatement, type CapturedLine, type PnlStatement } from "./statement";

const CAPTURED = "2026-03-01T15:00:00-07:00";

function line(partial: Omit<CapturedLine, "amount" | "sourceDocument" | "sourceHref" | "capturedAt"> & { amount: string; sourceDocument?: string; capturedAt?: string }): CapturedLine {
  const amount = parseAmount(partial.amount);
  if (!amount) throw new Error("Sample amount is not a captured number.");
  return {
    ...partial,
    amount,
    sourceDocument: partial.sourceDocument || "Sample package",
    sourceHref: "",
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
    line({ id: "PL-900005", periodId: "PP-900002", grain: "monthly", year: 2024, month: 1, throughMonth: null, business: "car_wash", code: "revenue", amount: "80000", status: "reported", sourcePage: "Jan" }),
    line({ id: "PL-900006", periodId: "PP-900002", grain: "monthly", year: 2024, month: 1, throughMonth: null, business: "car_wash", code: "labor", amount: "10000", status: "reported", sourcePage: "Jan" }),
    line({ id: "PL-900007", periodId: "PP-900003", grain: "monthly", year: 2024, month: 3, throughMonth: null, business: "car_wash", code: "revenue", amount: "90000", status: "reported", sourcePage: "Mar" }),
    line({ id: "PL-900008", periodId: "PP-900003", grain: "monthly", year: 2024, month: 3, throughMonth: null, business: "car_wash", code: "chemicals", amount: "12000", status: "reported", sourcePage: "Mar" }),
  ];
  return buildStatement(lines);
}
