import type { CommentAnchor, CommentTag } from "./anchor";
import { formatZonedTimestamp } from "./clock";

export async function postComment(input: {
  siteId: string;
  expectedVersion: number;
  entityId?: string;
  source: string;
  anchor?: CommentAnchor;
  parentId?: string;
  body?: string;
  tag?: CommentTag;
  mentions?: string[];
  resolved?: boolean;
}): Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = { at: formatZonedTimestamp() };
  if (input.body) payload.body = input.body;
  if (input.tag) payload.tag = input.tag;
  if (input.mentions) payload.mentions = input.mentions;
  if (input.resolved !== undefined) payload.resolved = input.resolved;
  if (input.parentId) payload.parent_id = input.parentId;
  if (input.anchor) {
    payload.anchor = input.anchor.type === "space"
      ? { type: "space", space_id: input.anchor.spaceId }
      : {
          type: input.anchor.type,
          line: input.anchor.line,
          ...(input.anchor.type === "pnl_cell" ? { period: input.anchor.period } : {}),
        };
  }
  const response = await fetch("/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      changes: [{
        entity_type: "comment",
        site_id: input.siteId,
        expected_version: input.expectedVersion,
        ...(input.entityId ? { entity_id: input.entityId } : {}),
        source: input.source,
        payload,
      }],
    }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string; results?: { entity_id?: string; version?: number }[] };
  if (!response.ok) return { ok: false, error: body.error || "That comment could not be saved." };
  const result = body.results?.[0];
  return { ok: true, id: result?.entity_id || input.entityId || "", version: result?.version || input.expectedVersion + 1 };
}
