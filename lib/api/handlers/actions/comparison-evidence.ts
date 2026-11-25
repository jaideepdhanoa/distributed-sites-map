import { findRequest, parseEvidenceTarget } from "@/lib/actions/evidenceLookup";
import { createWithReceipt } from "@/lib/actions/createReceipt";
import { gapReference } from "@/lib/actions/gapReference";
import { isResponse, jsonError, jsonOk, openActions, runWrite } from "@/lib/actions/http";
import { createNote } from "@/lib/actions/notes";
import { createSuggestion } from "@/lib/actions/suggestions";
import { getUsers } from "@/lib/users";

export async function GET(request: Request) {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const data = await runWrite(session, { action: "comparison.evidence.read" }, async sql => ({
    followUp: await findRequest(sql, parseEvidenceTarget(new URL(request.url).searchParams)),
    accounts: session.actionRole === "viewer" ? [] : getUsers().map(user => ({ id: user.u, name: user.displayName || user.u })),
  }));
  return isResponse(data) ? data : jsonOk(data);
}

export async function POST(request: Request) {
  const session = await openActions("contributor");
  if (isResponse(session)) return session;
  if (!request.headers.get("Idempotency-Key")) return jsonError("Missing save reference.", 400);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.description !== "string" || !body.description.trim() || body.description.length > 500) return jsonError("Describe the evidence in 1–500 characters.", 400);
  const result = await runWrite(session, { action: "comparison.evidence.request" }, async sql => {
    const target = parseEvidenceTarget(new URL(request.url).searchParams);
    return createWithReceipt(sql, request, session.u, { target, body }, async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [JSON.stringify([target.targetKind,target.targetId,target.source])]);
      const existing = await findRequest(tx,target);
      if (existing) return existing;
      const title = ("Verify " + target.context).slice(0,120);
      const note = await createNote(tx, { targetKind:target.targetKind, targetId:target.targetId, authorId:session.u,
        body: "Missing evidence\n" + body.description.trim() + "\nCheck: " + target.context + target.source,
        openOnly: true });
      await createSuggestion(tx, { targetKind:target.targetKind, targetId:target.targetId, authorId:session.u,
        field:"proposed_next_step", detail:"work_item", title, proposedValue:title, reason:gapReference(target.targetId,note.id),
        ownerId:body.owner, targetOn:body.due });
      return await findRequest(tx,target);
    });
  });
  return isResponse(result) ? result : jsonOk({ followUp:result });
}
