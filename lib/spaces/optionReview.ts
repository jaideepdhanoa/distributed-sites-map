import type { Note } from "@/lib/actions/notes";
import { options, usableOutline, type Option, type Point } from "./options";

export type Disposition = "Keep for diligence" | "Dismiss option";
export type Review = { disposition: Disposition; option: Option; area: string; revision: string; frame: string; points?: Point[]; reason: string; assumptions?: string };
export function reviewBody(review: Review) {
  return [
    "Space option review", options[review.option] + " · " + review.disposition,
    "Area: " + review.area, "Reason: " + review.reason.trim().replace(/\s+/g, " "),
    review.assumptions && "Scenario: " + review.assumptions,
    review.points && "Outline (%): " + review.points.map(p => p.join(",")).join(" / "),
    "Basis: " + review.revision + " · " + review.frame,
  ].filter(Boolean).join("\n");
}
export function readReview(note: Pick<Note, "body" | "deleted" | "parentId">): Review | null {
  if (note.deleted || note.parentId) return null;
  const lines = note.body.split("\n");
  if (lines[0] !== "Space option review") return null;
  const [label, disposition] = (lines[1] || "").split(" · ");
  const option = (Object.keys(options) as Option[]).find(key => options[key] === label);
  if (!option || (disposition !== "Keep for diligence" && disposition !== "Dismiss option")) return null;
  const field = (prefix: string) => lines.find(line => line.startsWith(prefix))?.slice(prefix.length) || "";
  const [revision, frame] = field("Basis: ").split(" · ");
  if (!revision || !frame) return null;
  const raw = field("Outline (%): ");
  const coords = raw ? raw.split(" / ").map(s => s.split(",").map(Number)) : undefined;
  const points = coords && coords.length >= 3 && coords.length <= 40 && coords.every(p => p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 100)) ? coords as Point[] : undefined;
  return { option, disposition, revision, frame, points: points && usableOutline(points) ? points : undefined, area: field("Area: "), reason: field("Reason: "), assumptions: field("Scenario: ") };
}
