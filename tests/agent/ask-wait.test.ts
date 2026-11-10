import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskThinking } from "../../components/agent/AskThinking";
import { EMPTY_ANSWER, NETWORK_ANSWER, TIMEOUT_ANSWER, UPSTREAM_ANSWER } from "../../lib/ask/empty";
import { answerQuestion } from "../../lib/ask/run";
import {
  ASK_CLIENT_TIMEOUT_MS,
  ASK_SERVER_BUDGET_MS,
  ASK_STILL_WORKING_MS,
  answeredByStageTable,
  askFailure,
  askOutcome,
  beginAsk,
  composerAfter,
  finishAsk,
  markStillWorking,
  showAskText,
  type AskTurn,
} from "../../lib/ask/wait";

const QUESTION = "Which Phoenix sites are furthest along?";

test("a question shows thinking, then the answer, and clears the composer", () => {
  let turns: AskTurn[] = beginAsk([], QUESTION);
  assert.equal(turns[1]?.pending, true);
  assert.equal(turns[1]?.text, "");
  assert.match(renderToStaticMarkup(createElement(AskThinking)), /Thinking/);
  assert.equal(renderToStaticMarkup(createElement(AskThinking)).match(/<i><\/i>/g)?.length, 3);
  turns = markStillWorking(turns);
  assert.equal(turns[1]?.slow, true);
  assert.match(renderToStaticMarkup(createElement(AskThinking, { slow: true })), /Still working/);
  turns = showAskText(turns, "Phoenix ");
  turns = finishAsk(turns, { text: "Phoenix has 26 listed deals still in play.", error: false });
  assert.equal(turns[1]?.pending, false);
  assert.match(turns[1]?.text || "", /26/);
  assert.equal(composerAfter(QUESTION, QUESTION, true), "");
});

test("a timeout keeps the question and a retry sends it again", () => {
  let turns = beginAsk([], QUESTION);
  turns = finishAsk(turns, askFailure(Object.assign(new Error("aborted"), { name: "AbortError" })));
  assert.equal(turns[1]?.text, TIMEOUT_ANSWER);
  assert.equal(turns[1]?.linkRetry, true);
  assert.equal(turns[1]?.error, true);
  assert.equal(composerAfter(QUESTION, QUESTION, false), QUESTION);
  const retry = beginAsk(turns, turns[0]?.text || "");
  assert.equal(retry[2]?.role, "user");
  assert.equal(retry[2]?.text, QUESTION);
  assert.equal(retry[3]?.pending, true);
  const answered = finishAsk(retry, { text: "The furthest are at the financial screen.", error: false });
  assert.match(answered[3]?.text || "", /financial/);
  assert.match(renderToStaticMarkup(createElement(AskThinking)), /ask-thinking/);
  assert.equal(ASK_CLIENT_TIMEOUT_MS, 50_000);
  assert.equal(ASK_STILL_WORKING_MS, 8_000);
});

test("a network failure is not the empty-answer or upstream copy", () => {
  const turns = finishAsk(beginAsk([], QUESTION), askFailure(new TypeError("Failed to fetch")));
  assert.equal(turns[1]?.text, NETWORK_ANSWER);
  assert.equal(turns[1]?.linkRetry, true);
  assert.notEqual(turns[1]?.text, EMPTY_ANSWER);
  assert.notEqual(turns[1]?.text, UPSTREAM_ANSWER);
  assert.equal(composerAfter(QUESTION, QUESTION, false), QUESTION);
});

test("an aborted model call returns a clean timeout instead of hanging", async () => {
  assert.equal(ASK_SERVER_BUDGET_MS, 40_000);
  assert.ok(ASK_SERVER_BUDGET_MS < ASK_CLIENT_TIMEOUT_MS);
  assert.equal(answeredByStageTable("Scope: portfolio\nQuestion: Which Phoenix deals are furthest along?"), true);
  assert.equal(answeredByStageTable("Scope: portfolio\nQuestion: How many listed deals are in Las Vegas?"), false);
  const logs: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => { logs.push(String(line ?? "")); };
  try {
    const answer = await answerQuestion({
      userId: "cindel",
      role: "viewer",
      question: QUESTION,
      siteId: null,
      runner: async () => {
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      },
    });
    assert.equal(answer.text, TIMEOUT_ANSWER);
    assert.equal(answer.error, true);
    assert.equal(askOutcome(answer), "timeout");
    assert.notEqual(answer.text, UPSTREAM_ANSWER);
    assert.equal(logs.some((line) => line.includes("sk-")), false);
  } finally {
    console.error = original;
  }
});
