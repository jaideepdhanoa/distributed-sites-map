import { z } from "zod";
import type { ActionRole } from "@/lib/actions/roles";
import { canDecide, canWriteContent } from "@/lib/actions/roles";
import { InputError } from "@/lib/actions/text";
import { assertClean } from "@/lib/policy/banned";
import {
  ACTIVITY_TYPES,
  CANONICAL_STAGES,
  COMMS_DIRECTIONS,
  MARKETS,
  SERVICE_AREA_CLASSES,
  SITE_ID,
  type ActivityType,
  type CommsDirection,
  type EntityType,
  type Market,
  type ServiceAreaClass,
  type StageName,
} from "./vocab";

export type Actor = { id: string; kind: "human" | "agent"; role?: ActionRole };

export type StagePayload = {
  stage: StageName;
  market: Market;
  service_area_class?: ServiceAreaClass | "";
  reason?: string;
};

export type ActivityPayload = {
  date: string;
  type: ActivityType;
  summary: string;
  source_link?: string;
};

export type CommsPayload = {
  direction: CommsDirection | "internal";
  at?: string;
  person?: string;
  firm?: string;
  channel?: string;
  summary?: string;
  subject?: string;
  site_ids?: string;
  thread_id?: string;
  link?: string;
  asks_made?: string;
  asks_answered?: string;
  attachments?: string;
  state_changes?: string;
  workbook_source?: string;
  message_id?: string;
};

export type ParsedChange = {
  entity_type: EntityType;
  site_id: string;
  entity_id?: string;
  expected_version: number;
  source: string;
  /** Workbook import keeps the sheet's id. The HTTP API never sets this. */
  preserve_id?: boolean;
  payload: StagePayload | ActivityPayload | CommsPayload;
};

const stagePayload = z
  .object({
    stage: z.enum(CANONICAL_STAGES),
    market: z.enum(MARKETS),
    service_area_class: z.enum(SERVICE_AREA_CLASSES).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const activityPayload = z
  .object({
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(ACTIVITY_TYPES),
    summary: z.string().trim().min(1).max(300),
    source_link: z.string().trim().max(500).optional(),
  })
  .strict();

const commsPayload = z
  .object({
    direction: z.enum(COMMS_DIRECTIONS),
    at: z.string().trim().max(40).optional(),
    person: z.string().trim().max(200).optional(),
    firm: z.string().trim().max(200).optional(),
    channel: z.string().trim().max(80).optional(),
    summary: z.string().trim().max(300).optional(),
    subject: z.string().trim().max(300).optional(),
  })
  .strict();

const changeSchema = z
  .object({
    entity_type: z.enum(["stage", "activity", "comms"]),
    site_id: z.string().trim().regex(SITE_ID),
    entity_id: z.string().trim().min(1).max(40).optional(),
    expected_version: z.number().int().nonnegative(),
    source: z.string().trim().min(1).max(200),
    payload: z.unknown(),
  })
  .strict();

const batchSchema = z
  .object({
    changes: z.array(changeSchema).min(1).max(100),
  })
  .strict();

function issueMessage(path: string, code: string): string {
  if (code === "unrecognized_keys") return "That field is not accepted.";
  if (path.endsWith("market")) return "Market must be one of PHX, LAS, MIA, SNA.";
  if (path.endsWith("service_area_class")) {
    return "Service area class must be one of Inside, Near 0-5, Near 5-10, Outside, Unknown.";
  }
  if (path.endsWith("source")) return "Every change needs a source.";
  if (path.endsWith("stage")) return "That stage is not a known stage.";
  if (path.endsWith("direction")) return "Comms direction must be in or out.";
  if (path.endsWith("site_id")) return "That site id is not valid.";
  if (path.endsWith("expected_version")) return "Version must be a whole number.";
  if (path === "changes" || path.endsWith("changes")) return "Add at least one change.";
  if (path.endsWith("date")) return "Use a calendar date.";
  if (path.endsWith("summary")) return "Add a summary.";
  return "That change is not valid.";
}

function fail(index: number | null, path: string, code: string): never {
  const label = issueMessage(path, code);
  throw new InputError(index == null ? label : `Change ${index + 1}: ${label}`);
}

function realDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cleanText(value: string | undefined): void {
  if (value) assertClean(value);
}

export function validateBatch(actor: Actor, idempotencyKey: string, body: unknown): { key: string; changes: ParsedChange[] } {
  const key = idempotencyKey.trim();
  if (!key) throw new InputError("Every batch needs an Idempotency-Key.");
  if (key.startsWith("shadow:")) throw new InputError("That Idempotency-Key is reserved.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key)) throw new InputError("That Idempotency-Key is not valid.");

  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.map(String).join(".");
    const index = issue.path.find((part) => typeof part === "number");
    fail(typeof index === "number" ? index : null, path, issue.code);
  }

  const changes: ParsedChange[] = parsed.data.changes.map((row, index) => {
    if (row.entity_id && (row.expected_version === 0 || row.entity_type === "stage")) {
      throw new InputError(`Change ${index + 1}: The server assigns ids.`);
    }
    if (row.expected_version > 0 && row.entity_type !== "stage" && !row.entity_id) {
      throw new InputError(`Change ${index + 1}: That update needs the record id.`);
    }
    if (row.entity_id && row.entity_type === "activity" && !/^A-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    if (row.entity_id && row.entity_type === "comms" && !/^CM-\d{4,}$/.test(row.entity_id)) {
      throw new InputError(`Change ${index + 1}: That record id is not valid.`);
    }
    cleanText(row.source);
    if (row.entity_type === "stage") {
      const parsedPayload = stagePayload.safeParse(row.payload);
      if (!parsedPayload.success) {
        const issue = parsedPayload.error.issues[0];
        fail(index, issue.path.map(String).join("."), issue.code);
      }
      const data = parsedPayload.data;
      cleanText(data.reason);
      assertStageActor(actor, index, data.stage, data.reason);
      return { ...row, payload: data };
    }
    if (row.entity_type === "activity") {
      const parsedPayload = activityPayload.safeParse(row.payload);
      if (!parsedPayload.success) {
        const issue = parsedPayload.error.issues[0];
        fail(index, issue.path.map(String).join("."), issue.code);
      }
      const data = parsedPayload.data;
      if (!realDate(data.date)) throw new InputError(`Change ${index + 1}: Use a calendar date.`);
    cleanText(data.summary);
    cleanText(data.source_link);
    assertContentActor(actor, index);
    return { ...row, payload: data };
    }
    const parsedPayload = commsPayload.safeParse(row.payload);
    if (!parsedPayload.success) {
      const issue = parsedPayload.error.issues[0];
      fail(index, issue.path.map(String).join("."), issue.code);
    }
    const data = parsedPayload.data;
    cleanText(data.person);
    cleanText(data.firm);
    cleanText(data.channel);
    cleanText(data.subject);
    cleanText(data.at);
    cleanText(data.summary);
    assertContentActor(actor, index);
    return { ...row, payload: data };
  });
  return { key, changes };
}

function assertStageActor(actor: Actor, index: number, stage: string, reason: string | undefined): void {
  // R-097. A drop is a reviewer decision with a reason. Agents cannot make it.
  if (stage === "Dropped" && actor.kind !== "human") {
    throw new InputError(`Change ${index + 1}: An agent cannot set Stage to Dropped.`);
  }
  if (actor.kind !== "human" || !actor.role || !canDecide(actor.role)) {
    throw new InputError(`Change ${index + 1}: Stage changes need a reviewer.`, 403);
  }
  if (stage === "Dropped" && !reason?.trim()) {
    throw new InputError(`Change ${index + 1}: Stage Dropped needs a reason.`);
  }
}

function assertContentActor(actor: Actor, index: number): void {
  if (actor.kind === "agent") return;
  if (!actor.role || !canWriteContent(actor.role)) {
    throw new InputError(`Change ${index + 1}: You do not have permission for that.`, 403);
  }
}
