import { z } from "zod";
import { readGeneratedOptional } from "@/lib/snapshot/read";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { type Assessment } from "./options";

const sourceDocument = z.string().regex(/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/);
const percent = z.number().min(0).max(100);
export const assessmentSchema = z.object({
  summary: z.string().min(1).max(1200), status: z.enum(["reviewed", "hold", "needs-image"]),
  recorded: z.number().int().nonnegative().nullable(), baseline: z.enum(["recorded", "unconfirmed", "conflict"]),
  zones: z.array(z.object({
    kind: z.enum(["pad", "parking", "vacuum", "apron", "storage", "bay", "clear"]), label: z.string().max(100),
    points: z.array(z.tuple([percent, percent])).min(3).max(40), check: z.string().max(600).optional(),
  })).max(30),
  segment: z.string().max(120), cohort: z.enum(["active", "off-market", "dropped"]), revision: z.string().regex(/^[a-f0-9]{12}$/),
  evidence: z.array(z.object({label:z.string().max(120),url:sourceDocument,option:z.enum(["retain","outdoor","bays"])})).max(8).optional(),
  image: z.object({
    kind: z.enum(["site-plan","site-photo"]).optional(), metersPerPixel: z.number().min(.01).max(4).optional(), documentUrl: sourceDocument.optional(),
    id: z.string().regex(/^[a-f0-9]{16}$/), width: z.number().int().positive(), height: z.number().int().positive(),
    src: z.string().max(220000).regex(/^(?:\/api\/data\/photos\/[a-f0-9]{20}\.(?:jpg|jpeg|png|webp)|data:image\/webp;base64,[A-Za-z0-9+/]+=*)$/),
    source: z.string().max(300), date: z.string().regex(/^(?:\d{4}-\d\d-\d\d)?$/),
    bounds: z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90),z.number().min(-180).max(180),z.number().min(-90).max(90)]).optional(),
  }).optional(),
});

function assessmentFile() {
  const file = readGeneratedOptional("space-layouts.json") as { version?: number; sites?: Record<string, unknown>; reviewedOn?: string } | undefined;
  if (file?.version !== 1 || !file.reviewedOn || !/^\d{4}-\d\d-\d\d$/.test(file.reviewedOn)) return null;
  return file;
}

export function assessedSiteIds() {
  return Object.keys(assessmentFile()?.sites || {}).filter(id => /^PIPE-(PHX|LAS|MIA|SNA)-\d{4,}$/.test(id) && !isExcludedSite(id));
}
export function layoutAssessment(site: string): { row: Assessment; reviewedOn: string } | null {
  if (!/^PIPE-(PHX|LAS|MIA|SNA)-\d{4,}$/.test(site) || isExcludedSite(site)) return null;
  const file = assessmentFile();
  if (!file?.reviewedOn) return null;
  const checked = assessmentSchema.safeParse(file.sites?.[site]);
  return checked.success ? { row: checked.data, reviewedOn: file.reviewedOn } : null;
}
