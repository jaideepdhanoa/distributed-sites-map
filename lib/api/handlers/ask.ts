import { consumeAskCredit } from "@/lib/ask/cap";
import { askReady } from "@/lib/ask/model";
import { answerQuestion, streamAnswer } from "@/lib/ask/run";
import { askOutcome } from "@/lib/ask/wait";
import { isSession, privateHeaders, requireUser } from "@/lib/guard";
import { NextResponse } from "next/server";

const NOT_READY = "Ask isn't set up yet";

export async function POST(request: Request) {
  const started = Date.now();
  let toolRounds = 0;
  let outcome = "rejected";
  const log = () => {
    console.info(JSON.stringify({
      event: "ask_request",
      duration_ms: Date.now() - started,
      tool_rounds: toolRounds,
      outcome,
    }));
  };
  try {
    const session = await requireUser();
    if (!isSession(session)) {
      outcome = "unauthorized";
      return session;
    }
    if (!askReady()) {
      outcome = "not_ready";
      return NextResponse.json({ error: NOT_READY }, { status: 503, headers: privateHeaders });
    }
    let body: { question?: string; siteId?: string | null };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      outcome = "bad_request";
      return NextResponse.json({ error: "The question could not be read." }, { status: 400, headers: privateHeaders });
    }
    const question = String(body.question || "").trim();
    if (!question || question.length > 2000) {
      outcome = "bad_request";
      return NextResponse.json({ error: "Write a question." }, { status: 400, headers: privateHeaders });
    }
    const siteId = String(body.siteId || "").trim();
    const credit = await consumeAskCredit(session.u);
    if (!credit.ok) {
      outcome = credit.reason === "limit" ? "limit" : "unavailable";
      const message = credit.reason === "limit" ? "The daily Ask limit has been reached." : "Ask isn't available right now.";
      return NextResponse.json({ error: message }, { status: 429, headers: privateHeaders });
    }
    const answer = await answerQuestion({
      userId: session.u,
      role: session.actionRole,
      question,
      siteId: siteId || null,
      signal: request.signal,
    });
    toolRounds = answer.toolsCalled.length;
    outcome = request.signal.aborted ? "disconnect" : askOutcome(answer);
    return new Response(streamAnswer(answer), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } finally {
    log();
  }
}
