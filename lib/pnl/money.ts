/** Captured dollar amounts. A missing fraction stays missing. Nothing is rounded onto the figure. */

const AMOUNT = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

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

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

export function centsToRaw(cents: bigint): string {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const whole = abs / HUNDRED;
  const frac = abs % HUNDRED;
  const raw = frac === ZERO ? `${whole}` : `${whole}.${String(frac).padStart(2, "0")}`;
  return negative ? `-${raw}` : raw;
}

export function formatAmount(raw: string): string {
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [whole, frac] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}${frac ? `.${frac}` : ""}`;
}

/** Truncated percent. A negative part keeps its sign. Not a stored P&L line. */
export function signedPercent(part: bigint, whole: bigint): string | null {
  if (whole <= ZERO) return null;
  const negative = part < ZERO;
  const text = percentOf(negative ? -part : part, whole);
  if (!text) return null;
  return negative ? `-${text}` : text;
}

/** Percent rounded to one decimal. Not a stored P&L line. */
export function percentOf(lineCents: bigint, revenueCents: bigint): string | null {
  if (revenueCents <= BigInt(0)) return null;
  const abs = lineCents < BigInt(0) ? -lineCents : lineCents;
  const tenths = (abs * BigInt(1000) + revenueCents / BigInt(2)) / revenueCents;
  const whole = tenths / BigInt(10);
  const dec = tenths % BigInt(10);
  return `${whole}.${dec}%`;
}

export function outsideBand(lineCents: bigint, revenueCents: bigint, low: number, high: number): boolean {
  if (revenueCents <= BigInt(0)) return false;
  const abs = lineCents < BigInt(0) ? -lineCents : lineCents;
  return abs * BigInt(100) < BigInt(low) * revenueCents || abs * BigInt(100) > BigInt(high) * revenueCents;
}
