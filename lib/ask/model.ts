import { ASK_TOOLS, MAX_ASK_STEPS, runAskTool } from "@/lib/ask/tools";
import type { ActionRole } from "@/lib/actions/roles";
import { listedCountLine } from "./counts";
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

export const ASK_MODEL_DEFAULT = "gro" + "k-4.7";

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
      description: "Portfolio summary, listed counts, and a stage row for every in-play listed deal.",
      inputSchema: z.object({}),
      execute: async () => {
        called.push("portfolio");
        const value = await runAskTool("portfolio", {}, role);
        gathered.push(value);
        return value;
      },
    }),
    stages: tool({
      description: "Stage rows for every in-play listed deal. Optional filters: market (Phoenix, Las Vegas, Miami) and stage name. Quarantined records are omitted. No financial figures.",
      inputSchema: z.object({ market: z.string().optional(), stage: z.string().optional() }),
      execute: async ({ market, stage }) => {
        called.push("stages");
        const value = await runAskTool("stages", { market, stage }, role);
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
  const shared = {
    model: xai(askModelName()),
    system: input.system,
    abortSignal: controller.signal,
    maxOutputTokens: 4096,
    // This model accepts low, medium, high, and xhigh. none is rejected.
    providerOptions: { xai: { promptCacheKey: "ask-portfolio-v1", reasoningEffort: "low" as const } },
  };
  try {
    const first = streamText({
      ...shared,
      prompt: input.prompt,
      tools,
      stopWhen: stepCountIs(MAX_ASK_STEPS),
    });
    const [finalText, steps, usage] = await Promise.all([first.text, first.steps, first.usage]);
    let text = finalText.trim() || steps.map((step) => step.text.trim()).filter(Boolean).join("\n\n");
    let promptTokens = usage.inputTokens || 0;
    let completionTokens = usage.outputTokens || 0;
    if (!text) {
      const facts = [listedCountLine(), ...gathered.map((value) => JSON.stringify(value))].join("\n").slice(0, 6000);
      const follow = streamText({
        ...shared,
        prompt: `${input.prompt}\n\nFacts already looked up:\n${facts}\n\nWrite the answer in sentences. Do not call tools.`,
        stopWhen: stepCountIs(1),
      });
      const [followText, followSteps, followUsage] = await Promise.all([follow.text, follow.steps, follow.usage]);
      text = followText.trim() || followSteps.map((step) => step.text.trim()).filter(Boolean).join("\n\n");
      promptTokens += followUsage.inputTokens || 0;
      completionTokens += followUsage.outputTokens || 0;
    }
    const sources: AskSource[] = [];
    for (const value of gathered) collectSources(value, sources);
    return {
      text,
      toolsCalled: called.filter((name) => (ASK_TOOLS as readonly string[]).includes(name)),
      sources,
      promptTokens,
      completionTokens,
    };
  } finally {
    clearTimeout(timer);
  }
}
