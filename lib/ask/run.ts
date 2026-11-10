import { randomUUID } from "node:crypto";
import { ingestAskGap } from "@/lib/agent/inbox";
import { actionsEnabled, withSql, type Sql } from "@/lib/actions/db";
import type { ActionRole } from "@/lib/actions/roles";
import { estimateCost } from "./cost";
import { EMPTY_ANSWER, TIMEOUT_ANSWER, UPSTREAM_ANSWER } from "./empty";
import { liveAskModel, type AskModelInput, type AskModelOutput } from "./model";
import { applyWordingTier, withCitations, type AskSource } from "./policy";
import { askPrefix } from "./prompt";
import { logUpstream, isAbortError } from "./upstream";

export type AskRunner = (input: AskModelInput) => Promise<AskModelOutput>;

export type AskAnswer = {
  text: string;
  gap: boolean;
  error: boolean;
  sources: AskSource[];
  toolsCalled: string[];
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
};

async function remember(input: {
  userId: string;
  scope: string;
  siteId: string | null;
  question: string;
  answer: AskAnswer;
}): Promise<void> {
  if (!actionsEnabled()) return;
  try {
    await withSql(async (sql: Sql) => {
      await sql.query(
        `INSERT INTO ask_log (
          id, user_id, scope, site_id, question, tools, sources, prompt_tokens, completion_tokens, estimated_cost, unanswered
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
        [
          randomUUID(),
          input.userId,
          input.scope,
          input.siteId,
          input.question.slice(0, 2000),
          JSON.stringify(input.answer.toolsCalled),
          JSON.stringify(input.answer.sources),
          input.answer.promptTokens,
          input.answer.completionTokens,
          input.answer.estimatedCost,
          input.answer.gap,
        ],
      );
      if (input.answer.gap) {
        await ingestAskGap(sql, { userId: input.userId, question: input.question.slice(0, 2000), siteId: input.siteId });
      }
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "ask_log_error", name: error instanceof Error ? error.name : "error" }));
  }
}

export async function answerQuestion(input: {
  userId: string;
  role: ActionRole;
  question: string;
  siteId: string | null;
  signal?: AbortSignal;
  runner?: AskRunner;
}): Promise<AskAnswer> {
  const question = input.question.trim().slice(0, 2000);
  const screened = applyWordingTier("", input.role, question);
  let answer: AskAnswer;
  if (screened.refused) {
    answer = {
      text: screened.text,
      gap: false,
      error: false,
      sources: [],
      toolsCalled: [],
      promptTokens: 0,
      completionTokens: 0,
      estimatedCost: 0,
    };
  } else {
    const runner = input.runner || liveAskModel;
    const scopeLine = input.siteId ? `Scope: site ${input.siteId}` : "Scope: portfolio and markets";
    const audience = input.role === "reviewer" ? "Audience: internal" : "Audience: map";
    let draft: AskModelOutput;
    let upstream = false;
    let timedOut = false;
    try {
      draft = await runner({
        system: askPrefix(),
        prompt: `${audience}\n${scopeLine}\nQuestion: ${question}`,
        role: input.role,
        signal: input.signal,
      });
    } catch (error) {
      logUpstream(error);
      timedOut = isAbortError(error);
      upstream = !timedOut;
      draft = { text: "", toolsCalled: [], sources: [], promptTokens: 0, completionTokens: 0 };
    }
    if (timedOut) {
      answer = {
        text: TIMEOUT_ANSWER,
        gap: false,
        error: true,
        sources: [],
        toolsCalled: [],
        promptTokens: 0,
        completionTokens: 0,
        estimatedCost: 0,
      };
    } else if (upstream) {
      answer = {
        text: UPSTREAM_ANSWER,
        gap: false,
        error: true,
        sources: [],
        toolsCalled: draft.toolsCalled,
        promptTokens: draft.promptTokens,
        completionTokens: draft.completionTokens,
        estimatedCost: 0,
      };
    } else if (!draft.text.trim()) {
      answer = {
        text: EMPTY_ANSWER,
        gap: false,
        error: true,
        sources: [],
        toolsCalled: draft.toolsCalled,
        promptTokens: draft.promptTokens,
        completionTokens: draft.completionTokens,
        estimatedCost: estimateCost(draft.promptTokens, draft.completionTokens),
      };
    } else {
      const worded = applyWordingTier(draft.text, input.role, question);
      const cited = withCitations(worded.text, worded.refused ? [] : draft.sources);
      answer = {
        text: cited.empty ? EMPTY_ANSWER : cited.text,
        gap: cited.empty ? false : cited.gap,
        error: cited.empty,
        sources: worded.refused || cited.empty ? [] : draft.sources,
        toolsCalled: draft.toolsCalled,
        promptTokens: draft.promptTokens,
        completionTokens: draft.completionTokens,
        estimatedCost: estimateCost(draft.promptTokens, draft.completionTokens),
      };
    }
  }
  await remember({
    userId: input.userId,
    scope: input.siteId ? "site" : "portfolio",
    siteId: input.siteId,
    question,
    answer,
  });
  return answer;
}

export function streamAnswer(answer: AskAnswer): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = answer.text;
  return new ReadableStream({
    start(controller) {
      const size = 80;
      for (let index = 0; index < payload.length; index += size) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: payload.slice(index, index + size) })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        done: true,
        text: payload,
        gap: answer.gap,
        error: answer.error,
        sources: answer.sources,
      })}\n\n`));
      controller.close();
    },
  });
}
