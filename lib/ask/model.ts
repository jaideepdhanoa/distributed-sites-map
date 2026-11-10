import { ASK_TOOLS, MAX_ASK_STEPS, runAskTool } from "@/lib/ask/tools";
import type { ActionRole } from "@/lib/actions/roles";
import type { AskSource } from "./policy";

export type AskModelInput = {
  system: string;
  prompt: string;
  role: ActionRole;
};

export type AskModelOutput = {
  text: string;
  toolsCalled: string[];
  sources: AskSource[];
  promptTokens: number;
  completionTokens: number;
};

export const ASK_MODEL_DEFAULT = "grok-4.7";

export function askModelName(): string {
  return process.env.ASK_MODEL?.trim() || ASK_MODEL_DEFAULT;
}

export function askReady(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

/**
 * Direct xAI call. The system string is the cached prefix (promptCacheKey).
 * Tests pass a runner and never call this.
 */
export async function liveAskModel(input: AskModelInput): Promise<AskModelOutput> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) throw new Error("missing_key");
  const { streamText, tool, stepCountIs } = await import("ai");
  const { createXai } = await import("@ai-sdk/xai");
  const { z } = await import("zod");
  const { collectSources } = await import("./policy");
  const xai = createXai({ apiKey });
  const role = input.role;
  const called: string[] = [];
  const gathered: unknown[] = [];
  const id = z.object({ id: z.string() });
  const tools = {
    searchSites: tool({
      description: "Search sanitized sites and deals by name, address, or id. Quarantined rows are named quarantined and have no values.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        called.push("searchSites");
        const value = await runAskTool("searchSites", { query }, role);
        gathered.push(value);
        return value;
      },
    }),
    getSite: tool({
      description: "Read one sanitized site or deal. Quarantined rows return only the quarantined status.",
      inputSchema: id,
      execute: async ({ id: siteId }) => {
        called.push("getSite");
        const value = await runAskTool("getSite", { id: siteId }, role);
        gathered.push(value);
        return value;
      },
    }),
    funnel: tool({
      description: "Portfolio funnel counts.",
      inputSchema: z.object({}),
      execute: async () => {
        called.push("funnel");
        const value = await runAskTool("funnel", {}, role);
        gathered.push(value);
        return value;
      },
    }),
    portfolio: tool({
      description: "Portfolio summary and the latest build changes.",
      inputSchema: z.object({}),
      execute: async () => {
        called.push("portfolio");
        const value = await runAskTool("portfolio", {}, role);
        gathered.push(value);
        return value;
      },
    }),
    discussion: tool({
      description: "Notes and suggestions on one site.",
      inputSchema: id,
      execute: async ({ id: siteId }) => {
        called.push("discussion");
        const value = await runAskTool("discussion", { id: siteId }, role);
        gathered.push(value);
        return value;
      },
    }),
    financials: tool({
      description: "Financial panel for one site, when the signed-in role may read it.",
      inputSchema: id,
      execute: async ({ id: siteId }) => {
        called.push("financials");
        const value = await runAskTool("financials", { id: siteId }, role);
        gathered.push(value);
        return value;
      },
    }),
    timeline: tool({
      description: "Timeline cards for one site.",
      inputSchema: id,
      execute: async ({ id: siteId }) => {
        called.push("timeline");
        const value = await runAskTool("timeline", { id: siteId }, role);
        gathered.push(value);
        return value;
      },
    }),
    activity: tool({
      description: "Timeline plus in-app activity for one site.",
      inputSchema: id,
      execute: async ({ id: siteId }) => {
        called.push("activity");
        const value = await runAskTool("activity", { id: siteId }, role);
        gathered.push(value);
        return value;
      },
    }),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const result = streamText({
      model: xai(askModelName()),
      system: input.system,
      prompt: input.prompt,
      tools,
      stopWhen: stepCountIs(MAX_ASK_STEPS),
      abortSignal: controller.signal,
      providerOptions: { xai: { promptCacheKey: "ask-portfolio-v1" } },
    });
    const [text, usage] = await Promise.all([result.text, result.usage]);
    const sources: AskSource[] = [];
    for (const value of gathered) collectSources(value, sources);
    return {
      text,
      toolsCalled: called.filter((name) => (ASK_TOOLS as readonly string[]).includes(name)),
      sources,
      promptTokens: usage.inputTokens || 0,
      completionTokens: usage.outputTokens || 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
