import { databaseUrl } from "@/lib/actions/db";
import { previewPointsAtProduction } from "@/lib/preview/safety";
import { databaseHost } from "./host";

export { databaseHost };

export class ProductionWriteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionWriteRefused";
  }
}

/** True when this process is production, or the URL host is the production endpoint. */
export function isProductionDatabase(url: string | null | undefined): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  const host = databaseHost(url);
  if (!host) return false;
  const named = process.env.NEON_PRODUCTION_HOST?.trim().toLowerCase();
  if (named && host === named) return true;
  const productionUrl = process.env.NEON_DATABASE_URL?.trim();
  return Boolean(productionUrl && databaseHost(productionUrl) === host);
}

export function shadowContext(): "manual" | "preview" | "ci" | "production" | "local" {
  if (process.env.ALLOW_PRODUCTION_MIGRATE === "1" && process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    return "manual";
  }
  if (process.env.VERCEL_ENV === "preview") return "preview";
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true") return "ci";
  return "local";
}

export type MigrationDecision = "apply" | "skip" | "refuse";

/**
 * Production schema changes run only from the manual workflow.
 * The Vercel production runtime skips pending files so a request cannot
 * apply them. CI and preview refuse, so a preview URL that points at
 * production does not migrate it.
 */
export function migrationDecision(url: string | null | undefined): MigrationDecision {
  if (previewPointsAtProduction(url)) return "refuse";
  if (!isProductionDatabase(url)) return "apply";
  const context = shadowContext();
  if (context === "manual") return "apply";
  if (context === "production") return "skip";
  return "refuse";
}

const REFUSE_MIGRATE =
  "Refusing to migrate the production database from CI or a preview. Production migrations run only from the Production migrations workflow.";

export function migrationRefusalMessage(): string {
  return REFUSE_MIGRATE;
}

/** API writes must not land on production when this process is CI or a preview. */
export function assertEventsWritable(): void {
  const context = shadowContext();
  if ((context === "preview" || context === "ci") && (previewPointsAtProduction() || isProductionDatabase(databaseUrl()))) {
    throw new ProductionWriteRefused("Refusing to write the production database from CI or a preview.");
  }
}

/** Workbook sync and the manual Shadow import, both on main, may raise id floors. They do not apply workbook rows. */
export function assertWorkbookImportAllowed(url: string): void {
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new ProductionWriteRefused("Refusing to import workbook rows from Vercel.");
  }
  const workflow = process.env.GITHUB_WORKFLOW;
  const allowed = workflow === "Workbook sync" || workflow === "Shadow import";
  if (process.env.GITHUB_REF !== "refs/heads/main" || !allowed) {
    throw new ProductionWriteRefused("Workbook import runs only from the Workbook sync job on main.");
  }
  if (!isProductionDatabase(url)) {
    throw new ProductionWriteRefused("Workbook import runs only against the production database.");
  }
}

/** The on-demand diff reads production and does not migrate or import. */
export function assertProductionDiff(url: string): void {
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new ProductionWriteRefused("Refusing to diff from Vercel. Run the Shadow diff workflow.");
  }
  if (!url.trim()) {
    throw new ProductionWriteRefused(
      "The shadow diff needs DATABASE_URL set to the production pooled connection string. Add the GitHub secret NEON_DATABASE_URL.",
    );
  }
  const productionHost = process.env.NEON_PRODUCTION_HOST?.trim().toLowerCase();
  if (!productionHost) {
    throw new ProductionWriteRefused(
      "NEON_PRODUCTION_HOST is not set. Add the repository variable: the production endpoint hostname only, with no user and no password.",
    );
  }
  if (databaseHost(url) !== productionHost) {
    throw new ProductionWriteRefused("Refusing to diff a database that is not production.");
  }
}

/**
 * Preview checks stay off the production database. The production hostname
 * is a variable, not a connection string, and is compared without being printed.
 */
export function assertPreviewTarget(url: string, purpose: "backfill" | "diff"): void {
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new ProductionWriteRefused(
      `Refusing to ${purpose} from Vercel. The shadow job runs in GitHub Actions against the Neon branch named preview.`,
    );
  }
  if (!url.trim()) {
    throw new ProductionWriteRefused(
      `${purpose === "backfill" ? "The shadow backfill" : "The shadow diff"} needs DATABASE_URL set to the pooled connection string for the Neon branch named preview. Add the GitHub secret NEON_PREVIEW_DATABASE_URL.`,
    );
  }
  if (process.env.NEON_BRANCH?.trim().toLowerCase() !== "preview") {
    throw new ProductionWriteRefused(
      `Refusing to ${purpose} unless NEON_BRANCH is preview. This job does not use the production database.`,
    );
  }
  const productionHost = process.env.NEON_PRODUCTION_HOST?.trim().toLowerCase();
  if (!productionHost) {
    throw new ProductionWriteRefused(
      "NEON_PRODUCTION_HOST is not set. Add the repository variable: the production endpoint hostname only, with no user and no password, so this job can refuse the production database.",
    );
  }
  if (databaseHost(url) === productionHost || isProductionDatabase(url)) {
    throw new ProductionWriteRefused(`Refusing to ${purpose} the production database from CI or a preview.`);
  }
}
