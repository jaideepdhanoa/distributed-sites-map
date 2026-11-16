import { sampleStatement } from "./fixture";
import type { PnlStatement } from "./statement";

/** Preview-only site that carries the synthetic sheet. Production never uses it. */
export const DEMO_PNL_SITE_ID = "PIPE-LAS-0011";

export function demoStatement(siteId: string): PnlStatement | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  if (siteId !== DEMO_PNL_SITE_ID) return null;
  return sampleStatement();
}
