import { z } from "zod";
import { isExcludedSite } from "@/lib/alerts/excluded";

const savings = z.object({
  stalls: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)]),
  base: z.number().finite(), stress: z.number().finite(),
});
const site = z.object({
  priority: z.string().min(1).max(160), check: z.string().min(1).max(1500),
  scope: z.string().min(1).max(200), note: z.string().min(1).max(1800),
  quote: z.number().finite().positive().nullable(), basis: z.string().min(1).max(200),
  source: z.string().url().startsWith("https://").nullable(), cases: z.array(savings).max(4),
}).refine(row => new Set(row.cases.map(c => c.stalls)).size === row.cases.length && (!row.cases.length || row.quote !== null));
const file = z.object({
  version: z.literal(1), reviewedOn: z.string().regex(/^\d{4}-\d\d-\d\d$/),
  sites: z.record(z.string().regex(/^PIPE-(PHX|LAS|MIA)-\d{4,}$/).refine(id=>!isExcludedSite(id)),site),
});
export type SelectionResearch = z.infer<typeof site> & { reviewedOn: string };
export function parseResearch(value: unknown): Map<string,SelectionResearch> {
  const parsed = file.parse(value);
  return new Map(Object.entries(parsed.sites).map(([id,row]) => [id,{...row,reviewedOn:parsed.reviewedOn}]));
}
