import { stageTitle } from "@/lib/labels";

/** A chip label stays on one line. Longer than this is detail, not a chip. */
export const CHIP_LABEL_MAX = 28;

/**
 * A chip is a short label. A middle dot joins clauses, so that string is not a chip.
 * Returns a problem sentence, or "" when the label fits.
 */
export function chipLabelProblem(label: string): string {
  const text = label.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.includes(" · ")) return "A chip cannot join clauses with a middle dot.";
  if (text.length > CHIP_LABEL_MAX) return `A chip label is at most ${CHIP_LABEL_MAX} characters.`;
  return "";
}

function warnChipLabel(label: string): void {
  const problem = chipLabelProblem(label);
  if (!problem || process.env.NODE_ENV === "production") return;
  console.warn(`${problem} ${JSON.stringify(label.slice(0, 80))}`);
}

/** First clause of a joined line, clipped to the chip limit. */
export function chipFace(label: string): { label: string; title: string } {
  const text = label.replace(/\s+/g, " ").trim();
  if (!chipLabelProblem(text)) return { label: text, title: "" };
  warnChipLabel(text);
  const clause = text.replace(/^NDA:\s*/i, "").split(" · ")[0]?.trim() || "";
  if (clause && !chipLabelProblem(clause)) return { label: clause, title: text };
  return { label: "NDA", title: text || label };
}

/** Stage chips use the stage name only. A parenthetical or a decision line is not the chip. */
export function stageChipLabel(stage: string, group: string): string {
  const name = stageTitle(group);
  if (name && name !== "Deal" && !chipLabelProblem(name)) return name;
  return chipFace(stage.trim() || name || "Stage").label;
}
