export type FunnelMode = "universe" | "pipeline";

/** Pipeline is the home view. Universe is a mode you switch to. */
export const FUNNEL_DEFAULT: FunnelMode = "pipeline";

export const FUNNEL_STORAGE = "funnel-mode";

/**
 * Bump when the product default changes, so an old implied Universe
 * (no stored choice) does not keep returning visitors on Universe.
 */
export const FUNNEL_VERSION = "2";

export const FUNNEL_VERSION_KEY = "funnel-mode-version";

export function isFunnelMode(value: string | null | undefined): value is FunnelMode {
  return value === "universe" || value === "pipeline";
}

/**
 * The URL `funnel` wins when it names a mode, including an explicit Universe link.
 * A stored choice counts only when it was saved under the current version.
 * A bare visit, and any unversioned leftover, opens Pipeline.
 */
export function resolveFunnelMode(
  urlValue: string | null | undefined,
  stored: { version: string | null | undefined; value: string | null | undefined },
): FunnelMode {
  if (isFunnelMode(urlValue)) return urlValue;
  if (stored.version === FUNNEL_VERSION && isFunnelMode(stored.value)) return stored.value;
  return FUNNEL_DEFAULT;
}
