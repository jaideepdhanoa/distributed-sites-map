import { NextResponse } from "next/server";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { overlayComms } from "@/lib/changes/read";
import { canSeeGmailLinks, commsForViewer, gmailHref, type CommsLine } from "@/lib/comms";
import { redactGmailPayload } from "@/lib/displayText";
import { loadCommsSnapshot } from "@/lib/commsLoad";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { ndaQueueAllowed } from "@/lib/nda";

async function columnHrefs(username: string, ids: string[]): Promise<Record<string, string>> {
  if (!canSeeGmailLinks(username) || !actionsEnabled()) return {};
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!wanted.length) return {};
  try {
    const rows = await withSql((sql) => sql.query<{
      entity_id: string;
      message_id: string | null;
      thread_id: string | null;
      link: string | null;
      gmail_message_id: string | null;
      gmail_thread_id: string | null;
    }>(
      `SELECT entity_id, message_id, thread_id, link, gmail_message_id, gmail_thread_id
       FROM comms_entries WHERE entity_id = ANY($1::text[])`,
      [wanted],
    ));
    const out: Record<string, string> = {};
    for (const row of rows.rows) {
      const href = gmailHref(row.link || "", row.gmail_message_id || row.message_id || "", row.gmail_thread_id || row.thread_id || "");
      if (href) out[row.entity_id] = href;
    }
    return out;
  } catch {
    return {};
  }
}

function applyHrefs(lines: CommsLine[], hrefs: Record<string, string>) {
  for (const line of lines) {
    const href = hrefs[line.commsId];
    if (href) line.href = href;
  }
}

export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!ndaQueueAllowed(session.actionRole)) {
    return NextResponse.json({ error: "You do not have permission for that." }, { status: 403, headers: privateHeaders });
  }
  const url = new URL(request.url);
  const ids = [url.searchParams.get("id") || "", url.searchParams.get("related") || ""];
  console.info(JSON.stringify({ event: "data", user: session.u, part: "comms" }));
  const snapshot = await overlayComms(loadCommsSnapshot(), ids);
  const body = commsForViewer(session.actionRole, session.u, snapshot, ids);
  if (!("error" in body) && canSeeGmailLinks(session.u)) {
    const hrefs = await columnHrefs(session.u, [...body.rows, ...body.internal].map((line) => line.commsId));
    applyHrefs(body.rows, hrefs);
    applyHrefs(body.internal, hrefs);
  }
  return NextResponse.json(redactGmailPayload(body), { headers: privateHeaders });
}
