import type { ActionRole } from "@/lib/actions/roles";
import { canDecide, canWriteContent } from "@/lib/actions/roles";
import { InputError } from "@/lib/actions/text";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { assertClean } from "@/lib/policy/banned";
import type { Actor } from "@/lib/changes/schema";
import { SITE_ID } from "@/lib/changes/vocab";
import { tagCode, tagFamily } from "./vocab";

export type TagPayload = {
  family: string;
  code: string;
  since?: string;
  source_ref?: string;
  note?: string;
  owner?: string;
  due_on?: string;
};

function clean(value: string | undefined): void {
  if (value) assertClean(value);
}

function allows(actor: Actor, owning: string): boolean {
  if (actor.kind === "agent" && actor.id.trim().toLowerCase() === "backfill") return true;
  const id = actor.id.trim().toLowerCase();
  if (owning === "reviewer") {
    if (actor.kind === "agent") return false;
    return Boolean(actor.role && canDecide(actor.role));
  }
  if (actor.kind === "agent") {
    if (owning === "muse") return id === "muse";
    if (owning === "indie") return id === "indie";
    if (owning === "capture") return id === "muse" || id === "indie";
    return false;
  }
  return Boolean(actor.role && canWriteContent(actor.role as ActionRole));
}

export function parseTag(actor: Actor, index: number, siteId: string, payload: unknown): TagPayload {
  if (isExcludedSite(siteId) || !SITE_ID.test(siteId)) {
    throw new InputError(`Change ${index + 1}: That site is not written here.`, 403);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputError(`Change ${index + 1}: That change is not valid.`);
  }
  const raw = payload as Record<string, unknown>;
  const family = typeof raw.family === "string" ? raw.family.trim() : "";
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  const known = tagFamily(family);
  if (!known || !tagCode(family, code)) {
    throw new InputError(`Change ${index + 1}: That chip is not in the vocabulary.`);
  }
  if (!allows(actor, known.owning)) {
    const decision = actor.kind === "agent" && known.owning === "reviewer";
    throw new InputError(
      decision
        ? `Change ${index + 1}: An agent cannot write that reason. A person decides.`
        : `Change ${index + 1}: That chip is owned by another role.`,
      403,
    );
  }
  const since = typeof raw.since === "string" ? raw.since.trim() : "";
  const source = typeof raw.source_ref === "string" ? raw.source_ref.trim() : "";
  if (source && !/^[a-z0-9_]{1,40}$/i.test(source)) {
    throw new InputError(`Change ${index + 1}: The source reference is not a column name.`);
  }
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 400) : "";
  const owner = typeof raw.owner === "string" ? raw.owner.trim().slice(0, 80) : "";
  const due = typeof raw.due_on === "string" ? raw.due_on.trim() : "";
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    throw new InputError(`Change ${index + 1}: The due date must be a calendar day.`);
  }
  clean(note);
  clean(owner);
  clean(source);
  const parsed: TagPayload = { family, code };
  if (since) parsed.since = since;
  if (source) parsed.source_ref = source;
  if (note) parsed.note = note;
  if (owner) parsed.owner = owner;
  if (due) parsed.due_on = due;
  return parsed;
}
