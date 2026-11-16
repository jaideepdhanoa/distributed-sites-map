/** How many events one projection pass reads. A feed page does not call this. */
export const EVENT_FEED_LIMIT = 200;

/** Third segment of an idempotency key that marks an event processed without a feed row. */
export const EVENT_SKIP_PART = "skip";

export function eventSkipKey(eventId: string): string {
  return `event:${eventId}:${EVENT_SKIP_PART}`;
}

/**
 * Hide skip markers from the feed. The key still matches `event:<id>:` so the
 * projection query treats the event as processed.
 */
export const VISIBLE_INBOX_SQL =
  "NOT (split_part(idempotency_key, ':', 1) = 'event' AND split_part(idempotency_key, ':', 3) = 'skip')";
