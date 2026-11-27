import type { Note } from "@/lib/actions/notes";
import { options, usableOutline, type Option, type Point, type Zone } from "./options";

export type Disposition = "Keep for diligence" | "Dismiss option" | "Adjust outline";
export type FitEvidence = { stalls: number; source: string; predicted?: [number, number] };
export function fitOutcome(evidence: FitEvidence) {
  const range = evidence.predicted;
  if (!range || (range[0] < 4 && range[1] >= 4)) return evidence.stalls >= 4 ? "Measurement supports four stalls" : "Measurement falls below four stalls";
  if (range[0] >= 4 && evidence.stalls < 4) return "Aerial overestimated four-stall fit";
  if (range[1] < 4 && evidence.stalls >= 4) return "Aerial missed a four-stall layout";
  return "Measurement agrees with the aerial at four stalls";
}
export type Review = { disposition: Disposition; option: Option; area: string; revision: string; frame: string; points?: Point[]; reason: string; assumptions?: string; measured?: FitEvidence; useRight?:Zone["useRight"] };
export function reviewBody(review: Review) {
  return [
    "Space option review", options[review.option] + " · " + review.disposition,
    "Area: " + review.area, "Reason: " + review.reason.trim().replace(/\s+/g, " "),
    review.useRight && "Use validation: " + review.useRight.status,
    review.useRight && "Use evidence: " + review.useRight.detail.trim().replace(/\s+/g," "),
    review.assumptions && "Scenario: " + review.assumptions,
    review.measured && "Measured stalls: " + review.measured.stalls,
    review.measured && "Measurement source: " + review.measured.source.trim().replace(/\s+/g, " "),
    review.measured?.predicted && "Aerial range: " + review.measured.predicted.join("–"),
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
  if (!option || (disposition !== "Keep for diligence" && disposition !== "Dismiss option" && disposition !== "Adjust outline")) return null;
  const field = (prefix: string) => lines.find(line => line.startsWith(prefix))?.slice(prefix.length) || "";
  const [revision, frame] = field("Basis: ").split(" · ");
  if (!revision || !frame) return null;
  const raw = field("Outline (%): ");
  const coords = raw ? raw.split(" / ").map(s => s.split(",").map(Number)) : undefined;
  const points = coords && coords.length >= 3 && coords.length <= 40 && coords.every(p => p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 100)) ? coords as Point[] : undefined;
  const count = field("Measured stalls: ");
  const source = field("Measurement source: ");
  const range = field("Aerial range: ").split("–");
  const measured: FitEvidence | undefined = /^\d{1,4}$/.test(count) && source ? { stalls: Number(count), source } : undefined;
  if (measured && range.length === 2 && range.every(v => /^\d+$/.test(v)) && Number(range[0]) <= Number(range[1])) measured.predicted = [Number(range[0]), Number(range[1])];
  const status = field("Use validation: ");
  const detail = field("Use evidence: ");
  const legacy = field("Reason: ").match(/^(.+) · Rights: (Unconfirmed|Supported by evidence|Conditional or shared|Unavailable) · Operating availability: [^·]+$/);
  const useRight:Zone["useRight"] = detail && (status==="documented" || status==="unconfirmed" || status==="unavailable")
    ? {status,detail} : legacy ? {status:legacy[2]==="Unavailable" ? "unavailable" : legacy[2]==="Supported by evidence" ? "documented" : "unconfirmed",detail:legacy[1]} : undefined;
  return { ...(useRight ? {useRight}:{}), ...(measured ? { measured } : {}), option, disposition, revision, frame, points: points && usableOutline(points) ? points : undefined, area: field("Area: "), reason: field("Reason: "), assumptions: field("Scenario: ") };
}
