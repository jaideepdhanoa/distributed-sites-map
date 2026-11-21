import { createHash } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";

export const DOC_TYPES = ["site", "broker", "comms", "note", "intel", "activity", "pnl_line"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type Visibility = "public" | "signed-in" | "jaideep-only";

export type SearchDraft = {
  docType: DocType;
  entityId: string;
  siteId: string;
  brokerId: string;
  title: string;
  body: string;
  visibility: Visibility;
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const GMAIL_URL = /https:\/\/mail\.google\.com\S*/gi;

export function scrub(value: unknown): string {
  return String(value ?? "")
    .replace(EMAIL, "")
    .replace(GMAIL_URL, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export function foldKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function brokerKey(name: string, siteId: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${slug || "broker"}:${siteId}`;
}

export function contentHash(title: string, body: string): string {
  return createHash("sha256").update(`${title}\n${body}`).digest("hex");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function draftsForRecord(input: {
  entityType: string;
  entityId: string;
  siteId: string;
  payload: Record<string, unknown>;
}): SearchDraft[] {
  if (isExcludedSite(input.siteId) || isExcludedSite(input.entityId)) return [];
  const siteId = input.siteId;
  if (input.entityType === "site") {
    const name = scrub(input.payload.name);
    const address = scrub(input.payload.address);
    const apn = scrub(input.payload.apn);
    const market = scrub(input.payload.market);
    const category = scrub(input.payload.category);
    const drafts: SearchDraft[] = [{
      docType: "site",
      entityId: siteId,
      siteId,
      brokerId: "",
      title: name || siteId,
      body: [address, apn, market, category, siteId].filter(Boolean).join(" "),
      visibility: "signed-in",
    }];
    const broker = scrub(input.payload.broker);
    const firm = scrub(input.payload.firm);
    if (broker || firm) {
      drafts.push({
        docType: "broker",
        entityId: brokerKey(broker || firm, siteId),
        siteId,
        brokerId: brokerKey(broker || firm, siteId),
        title: broker || firm,
        body: firm && firm !== broker ? firm : "",
        visibility: "signed-in",
      });
    }
    return drafts;
  }
  if (input.entityType === "comms") {
    const person = scrub(input.payload.person);
    return [{
      docType: "comms",
      entityId: input.entityId,
      siteId,
      brokerId: "",
      title: person || "Conversation",
      body: scrub(input.payload.summary),
      visibility: "signed-in",
    }];
  }
  if (input.entityType === "activity") {
    return [{
      docType: "activity",
      entityId: input.entityId,
      siteId,
      brokerId: "",
      title: scrub(input.payload.type) || "Activity",
      body: scrub(input.payload.summary),
      visibility: "signed-in",
    }];
  }
  if (input.entityType === "comment" || input.entityType === "note") {
    if (input.entityType === "comment" && !scrub(input.payload.body)) return [];
    return [{
      docType: "note",
      entityId: input.entityId,
      siteId,
      brokerId: "",
      title: "Note",
      body: scrub(input.payload.body),
      visibility: "signed-in",
    }];
  }
  if (input.entityType === "intel") {
    return [{
      docType: "intel",
      entityId: input.entityId,
      siteId,
      brokerId: "",
      title: scrub(input.payload.title) || "Intel",
      body: scrub(input.payload.body),
      visibility: "jaideep-only",
    }];
  }
  if (input.entityType === "pnl_line") {
    const line = scrub(input.payload.line);
    const year = scrub(input.payload.year);
    const grain = input.payload.grain === "monthly" ? "monthly" : "annual";
    return [{
      docType: "pnl_line",
      entityId: input.entityId,
      siteId,
      brokerId: "",
      title: [line, year].filter(Boolean).join(" ") || "P&L line",
      body: grain,
      visibility: "jaideep-only",
    }];
  }
  return [];
}

async function hasColumn(sql: Sql, column: string): Promise<boolean> {
  const rows = await sql.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'search_docs' AND column_name = $1`,
    [column],
  );
  return rows.rows.length > 0;
}

export async function upsertSearchDoc(sql: Sql, draft: SearchDraft): Promise<void> {
  if (isExcludedSite(draft.siteId) || isExcludedSite(draft.entityId)) return;
  if (!(await hasColumn(sql, "doc_type"))) return;
  const title = scrub(draft.title).slice(0, 300);
  const body = scrub(draft.body);
  const hash = contentHash(title, body);
  const vector = await hasColumn(sql, "embedding");
  const embedding = vector
    ? `, embedding = CASE WHEN search_docs.content_hash = EXCLUDED.content_hash THEN search_docs.embedding ELSE NULL END`
    : "";
  await sql.query(
    `INSERT INTO search_docs (doc_type, entity_id, site_id, broker_id, title, body, visibility, content_hash, embedded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
     ON CONFLICT (doc_type, entity_id) DO UPDATE SET
       site_id = EXCLUDED.site_id,
       broker_id = EXCLUDED.broker_id,
       title = EXCLUDED.title,
       body = EXCLUDED.body,
       visibility = EXCLUDED.visibility,
       embedded_at = CASE WHEN search_docs.content_hash = EXCLUDED.content_hash THEN search_docs.embedded_at ELSE NULL END
       ${embedding},
       content_hash = EXCLUDED.content_hash,
       updated_at = clock_timestamp()`,
    [draft.docType, draft.entityId, draft.siteId, draft.brokerId, title, body, draft.visibility, hash],
  );
}

export async function indexRecord(sql: Sql, input: {
  entityType: string;
  entityId: string;
  siteId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  for (const draft of draftsForRecord(input)) await upsertSearchDoc(sql, draft);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export { text };
