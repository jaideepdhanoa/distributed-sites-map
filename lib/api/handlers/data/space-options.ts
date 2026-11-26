import { NextResponse } from "next/server";
import { roleAllows } from "@/lib/actions/roles";
import { askReady } from "@/lib/ask/model";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { layoutAssessment } from "@/lib/spaces/assessmentLoad";
import { cachedDraft, generateOptions, liveSource } from "@/lib/spaces/generateOptions";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}
export async function GET(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  const id = new URL(request.url).searchParams.get("site") || "";
  const assessment = layoutAssessment(id);
  if (assessment && assessment.row.status !== "needs-image") return json({ assessment });
  const source = await liveSource(id);
  const draft = source ? await cachedDraft(source).catch(() => null) : null;
  return json({ assessment: draft || assessment, canDraft: Boolean(!draft && source && askReady() && roleAllows(session.actionRole,"contributor")) });
}
export async function POST(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!roleAllows(session.actionRole,"contributor")) return json({error:"Contributor access required."},403);
  const id = new URL(request.url).searchParams.get("site") || "";
  const existing = layoutAssessment(id);
  if (existing && existing.row.status !== "needs-image") return json({assessment:existing});
  const source = await liveSource(id);
  if (!source) return json({error:"A parcel-matched aerial is required."},422);
  try { return json({assessment:await generateOptions(source,session.u,request.signal)}); }
  catch { return json({error:"The draft could not be confirmed. Check the source image or retry when drafting is available."},503); }
}
