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
    let body: { question?: string; siteId?: string | null; siteIds?: unknown };
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
    const ids = body.siteIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length === 0 || ids.length > 20 || siteId || ids.some(id => typeof id !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(id)))) {
      return NextResponse.json({ error: "Choose up to 20 sites in one shortlist." }, { status: 400, headers: privateHeaders });
    }
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
      siteIds: ids ? Array.from(new Set(ids as string[])) : undefined,
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
