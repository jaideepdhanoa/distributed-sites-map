import type { PinLabel } from "@/lib/keyNumbers";

/** Asking price. Older sessions stored an implicit Off or $/ac choice under the unversioned key. */
export const PIN_LABEL_DEFAULT: PinLabel = "asking";

export const PIN_LABEL_STORAGE = "pin-label";

/** Bump when the product default changes, so an old implicit value does not win. */
export const PIN_LABEL_VERSION = "2";

export const PIN_LABEL_VERSION_KEY = "pin-label-version";

const CHOICES = new Set<PinLabel>(["none", "asking", "acres", "peracre"]);

export function isPinLabel(value: string | null | undefined): value is PinLabel {
  return CHOICES.has(value as PinLabel);
}

/**
 * The URL `pill` wins, including an explicit Off.
 * A stored choice counts only when it was saved under the current version.
 * Unset storage and the previous implicit default both resolve to asking price.
 */
export function resolvePinLabel(
  urlValue: string | null | undefined,
  stored: { version: string | null | undefined; value: string | null | undefined },
): PinLabel {
  if (isPinLabel(urlValue)) return urlValue;
  if (stored.version === PIN_LABEL_VERSION && isPinLabel(stored.value)) return stored.value;
  return PIN_LABEL_DEFAULT;
}
