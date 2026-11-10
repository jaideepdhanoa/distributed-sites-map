import { consumeAskCredit } from "@/lib/ask/cap";
import { askReady } from "@/lib/ask/model";
import { answerQuestion, streamAnswer } from "@/lib/ask/run";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { NextResponse } from "next/server";

const NOT_READY = "Ask isn't set up yet";

export async function POST(request: Request) {
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (!askReady()) {
    return NextResponse.json({ error: NOT_READY }, { status: 503, headers: privateHeaders });
  }
  let body: { question?: string; siteId?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "The question could not be read." }, { status: 400, headers: privateHeaders });
  }
  const question = String(body.question || "").trim();
  if (!question || question.length > 2000) {
    return NextResponse.json({ error: "Write a question." }, { status: 400, headers: privateHeaders });
  }
  const siteId = String(body.siteId || "").trim();
  const credit = await consumeAskCredit(session.u);
  if (!credit.ok) {
    const message = credit.reason === "limit" ? "The daily Ask limit has been reached." : "Ask isn't available right now.";
    return NextResponse.json({ error: message }, { status: 429, headers: privateHeaders });
  }
  const answer = await answerQuestion({
    userId: session.u,
    role: session.actionRole,
    question,
    siteId: siteId || null,
  });
  return new Response(streamAnswer(answer), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
