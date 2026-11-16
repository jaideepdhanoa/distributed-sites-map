/** Captured dollar amounts. A missing fraction stays missing. Nothing is rounded onto the figure. */

const AMOUNT = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{2})?$/;

export type CapturedAmount = { raw: string; cents: bigint };

export function parseAmount(value: string): CapturedAmount | null {
  const text = value.trim();
  if (!AMOUNT.test(text)) return null;
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole, frac = ""] = body.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt((frac + "00").slice(0, 2));
  return { raw: text, cents: negative ? -cents : cents };
}

export function formatAmount(raw: string): string {
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [whole, frac] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}${frac ? `.${frac}` : ""}`;
}

/** Truncated percent of two captured amounts. Not a stored P&L line. */
export function percentOf(lineCents: bigint, revenueCents: bigint): string | null {
  if (revenueCents <= BigInt(0)) return null;
  const abs = lineCents < BigInt(0) ? -lineCents : lineCents;
  const bps = (abs * BigInt(10000)) / revenueCents;
  const whole = bps / BigInt(100);
  const frac = bps % BigInt(100);
  if (frac === BigInt(0)) return `${whole}%`;
  if (frac % BigInt(10) === BigInt(0)) return `${whole}.${frac / BigInt(10)}%`;
  return `${whole}.${String(frac).padStart(2, "0")}%`;
}

export function outsideBand(lineCents: bigint, revenueCents: bigint, low: number, high: number): boolean {
  if (revenueCents <= BigInt(0)) return false;
  const abs = lineCents < BigInt(0) ? -lineCents : lineCents;
  return abs * BigInt(100) < BigInt(low) * revenueCents || abs * BigInt(100) > BigInt(high) * revenueCents;
}
