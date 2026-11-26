import { z } from "zod";
import { isExcludedSite } from "../alerts/excluded";

export const dispositions = ["Shortlist", "Service diligence", "Reserve", "Suggest drop", "Hold", "Watch availability",
  "Close offering", "Archive listing", "Outside mandate", "Conditional", "Previously dropped", "Off-market prospect"] as const;
export const routes = ["Operating acquisition", "Offered acquisition", "Operating lease", "Service premises",
  "Fleet service", "Host agreement", "Property only", "Site lead"] as const;
const text = z.string().trim().min(1).max(2200);
const link = z.url().startsWith("https://");
const optionSchema = z.object({
  route: z.enum(routes), disposition: z.enum(dispositions), rank: z.number().int().positive().nullable(),
  rationale: text, next: text, reviewedOn: z.iso.date(), owner: text.nullable(), revisitOn: z.iso.date().nullable(),
  evidence: link, offering: text.nullable(),
}).refine(row => row.rank === null || ["Shortlist", "Service diligence"].includes(row.disposition));
const siteSchema = z.object({ name: text, primary: optionSchema, alternatives: z.array(optionSchema).max(20) })
  .refine(row => new Set([row.primary, ...row.alternatives].map(o => o.route)).size === row.alternatives.length + 1);
const fileSchema = z.object({
  version: z.literal(1), register: z.url().regex(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit$/).nullable(),
  sites: z.record(z.string().regex(/^PIPE-[A-Z]{3}-\d{4,}$/).refine(id => !isExcludedSite(id)), siteSchema),
});
export type OpportunitySite = z.infer<typeof siteSchema>;
export type Opportunity = z.infer<typeof optionSchema>;
export type FiledReview = { id: string; city: string; stage: string; review: OpportunitySite };

export function parseOpportunities(value: unknown) {
  const file = fileSchema.parse(value);
  const ranks = new Set<string>();
  if (!Object.keys(file.sites).length) throw Error("An opportunity register needs at least one site.");
  for (const site of Object.values(file.sites)) {
    for (const option of [site.primary, ...site.alternatives]) {
      if (option.rank === null) continue;
      const key = option.disposition + "/" + option.rank;
      if (ranks.has(key)) throw Error("Diligence ranks must be unique within each list.");
      ranks.add(key);
    }
  }
  return file;
}

export function compareAttention(a?: Opportunity, b?: Opportunity) {
  const order = (o?: Opportunity) => o ? dispositions.indexOf(o.disposition) : dispositions.indexOf("Hold") - 0.5;
  return order(a) - order(b) || (a?.rank ?? Infinity) - (b?.rank ?? Infinity) || 0;
}
