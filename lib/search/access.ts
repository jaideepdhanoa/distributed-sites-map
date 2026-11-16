import type { Visibility } from "./docs";

const JAIDEEP = "jai" + "deep";

export function visibilityFor(user: { id?: string; kind?: string }): Visibility[] {
  const levels: Visibility[] = ["public", "signed-in"];
  if (user.kind !== "agent" && String(user.id || "").trim().toLowerCase() === JAIDEEP) levels.push("jaideep-only");
  return levels;
}
