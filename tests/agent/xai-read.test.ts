import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createXai } from "@ai-sdk/xai";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { EMPTY_ANSWER, UPSTREAM_ANSWER } from "../../lib/ask/empty";
import { answerQuestion } from "../../lib/ask/run";
import { logUpstream } from "../../lib/ask/upstream";
import { readXaiResponse } from "../../lib/ask/xai-read";

const recorded = JSON.parse(readFileSync(new URL("./fixtures/xai-response.json", import.meta.url), "utf8")) as {
  output: unknown[];
  usage: unknown;
  id: string;
  status: string;
  object: string;
};

function sse(events: unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
}

const completed = (output: unknown[]) => ({
  type: "response.completed",
  response: {
    id: recorded.id,
    object: "response",
    status: "completed",
    output,
    usage: recorded.usage,
  },
});

test("a recorded xAI response yields the message text and the tool call, not the reasoning", () => {
  const read = readXaiResponse(recorded);
  assert.equal(read.text, "Phoenix has 26 listed deals still in play. Las Vegas has 13. Miami has 8.");
  assert.deepEqual(read.toolCalls, [{ name: "portfolio", arguments: "{}" }]);
  assert.equal(read.text.includes("Look up the portfolio"), false);
});

test("the provider parser reads that recorded stream, including the tool call", async () => {
  const toolItem = recorded.output[1];
  const message = recorded.output[2];
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (!url.includes("api.x.ai")) throw new Error(`unexpected ${url}`);
    calls += 1;
    const events = calls === 1
      ? [
          { type: "response.output_item.done", output_index: 0, item: toolItem },
          completed([toolItem]),
        ]
      : [
          {
            type: "response.output_text.delta",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            delta: "Phoenix has 26 listed deals still in play. Las Vegas has 13. Miami has 8.",
          },
          completed([message]),
        ];
    return new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const result = streamText({
    model: createXai({ apiKey: "test-key", fetch: fetchImpl })("grok-4.7"),
    prompt: "How many listed deals are still in play?",
    tools: {
      portfolio: tool({
        description: "Portfolio counts.",
        inputSchema: z.object({}),
        execute: async () => ({ listedByMarket: [{ name: "Phoenix", listed: 26 }] }),
      }),
    },
    stopWhen: stepCountIs(2),
  });
  const [text, steps] = await Promise.all([result.text, result.steps]);
  assert.match(text, /Phoenix has 26/);
  assert.equal(steps.some((step) => step.toolCalls.some((call) => call.toolName === "portfolio")), true);
  assert.equal(text.includes("Look up the portfolio"), false);
});

test("an upstream 400 is logged and is not shown as an empty answer", async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => {
    lines.push(String(line ?? ""));
  };
  try {
    const failure = Object.assign(new Error("xAI rejected the request"), {
      statusCode: 400,
      responseBody: '{"error":{"message":"reasoning effort none is not supported for this model"},"authorization":"Bearer sk-secret-token"}',
    });
    const answer = await answerQuestion({
      userId: "cindel",
      role: "viewer",
      question: "How many listed deals are in Phoenix?",
      siteId: null,
      runner: async () => {
        logUpstream(failure);
        throw failure;
      },
    });
    assert.equal(answer.text, UPSTREAM_ANSWER);
    assert.notEqual(answer.text, EMPTY_ANSWER);
    assert.equal(answer.error, true);
    const logged = lines.join("\n");
    assert.match(logged, /ask_upstream/);
    assert.match(logged, /"status":400/);
    assert.match(logged, /not supported/);
    assert.equal(logged.includes("sk-secret-token"), false);
    assert.equal(logged.includes("Bearer sk-"), false);
  } finally {
    console.error = original;
  }
});
