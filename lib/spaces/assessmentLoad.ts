import { z } from "zod";
import { readGeneratedOptional } from "@/lib/snapshot/read";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { type Assessment } from "./options";

const sourceDocument = z.string().regex(/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/);
const percent = z.number().min(0).max(100);
export const assessmentSchema = z.object({
  reviewedOn:z.string().regex(/^\d{4}-\d\d-\d\d$/).optional(),
  inventory: z.object({parking:z.string().min(1).max(600),ground:z.string().min(1).max(600),operations:z.string().min(1).max(600),bays:z.string().min(1).max(600)}).optional(),
  parcelCases: z.array(z.object({name:z.string().min(1).max(100),condition:z.string().min(1).max(450),approach:z.array(z.tuple([percent,percent])).min(2).max(40).optional(),conversionCost:z.number().nonnegative().optional(),lostAnnualCash:z.number().nonnegative().optional(),rows:z.array(z.object({area:z.string().min(1).max(100),edge:z.number().int().min(0).max(39),angle:z.union([z.literal(45),z.literal(60),z.literal(90)]),count:z.number().int().min(1).max(100)})).min(1).max(12)})).max(8).optional(),
  summary: z.string().min(1).max(1200), status: z.enum(["reviewed", "hold", "needs-image"]),
  recorded: z.number().int().nonnegative().nullable(), baseline: z.enum(["recorded", "unconfirmed", "conflict"]),
  zones: z.array(z.object({
    kind: z.enum(["ground", "pad", "parking", "vacuum", "apron", "storage", "bay", "clear"]), label: z.string().max(100),
    points: z.array(z.tuple([percent, percent])).min(3).max(40), check: z.string().max(600).optional(),
    driveAisle: z.array(z.tuple([percent,percent])).min(3).max(40).optional(),
    useRight: z.object({status:z.enum(["documented","unconfirmed"]),detail:z.string().trim().min(1).max(600)}).optional(),
    fitHold: z.enum(["footprint", "aisle"]).optional(),
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

function safeSiteId(id:string) {
  return /^PIPE-(PHX|LAS|MIA|SNA)-\d{4,}$/.test(id) && !isExcludedSite(id);
}

export function assessedSiteIds() {
  return Object.keys(assessmentFile()?.sites || {}).filter(safeSiteId);
}
export function assessedLayouts(): [string, Assessment][] {
  const rows = Object.entries(assessmentFile()?.sites || {});
  return rows.flatMap(([site,value]) => {
    if (!safeSiteId(site)) return [];
    const result = assessmentSchema.safeParse(value);
    return result.success ? [[site,result.data] as [string,Assessment]] : [];
  });
}

export function layoutAssessment(site: string): { row: Assessment; reviewedOn: string } | null {
  if (!safeSiteId(site)) return null;
  const file = assessmentFile();
  if (!file?.reviewedOn) return null;
  const checked = assessmentSchema.safeParse(file.sites?.[site]);
  return checked.success ? { row: checked.data, reviewedOn: checked.data.reviewedOn ?? file.reviewedOn } : null;
}
