import { after } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { batchWindowMs } from "./clock";
import { flushInstant } from "./deliver";

/** Stay inside the catch-all maxDuration of 300 even if ALERT_BATCH_MS is long. */
export const BACKGROUND_FLUSH_CAP_MS = 90_000;

const FLUSH_GRACE_MS = 1_000;

export function backgroundFlushDelayMs(windowMs = batchWindowMs()): number {
  if (windowMs <= 0) return 0;
  return Math.min(windowMs + FLUSH_GRACE_MS, BACKGROUND_FLUSH_CAP_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait out the debounce, then flush. The database stays closed during the wait. */
export async function runScheduledFlush(
  waitMs = backgroundFlushDelayMs(),
  sleep: (ms: number) => Promise<void> = delay,
): Promise<void> {
  if (waitMs > 0) await sleep(waitMs);
  if (!actionsEnabled()) return;
  await withSql((sql) => flushInstant(sql));
}

/**
 * Run a flush after the response. `after` keeps the function alive on Vercel
 * via waitUntil. Outside a request the GitHub flush is the backstop.
 */
export function scheduleInstantFlush(): void {
  const waitMs = backgroundFlushDelayMs();
  try {
    after(async () => {
      try {
        await runScheduledFlush(waitMs);
      } catch {
        // The five-minute GitHub flush retries.
      }
    });
  } catch {
    // Not inside a request. The scheduled flush sends these rows.
  }
}
