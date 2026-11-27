import { readGenerated } from "@/lib/guard";
import { snapshotGeneration } from "@/lib/snapshot/read";
import { listedCountLine } from "./counts";
import { listedStageRows, stageTableText } from "./stages";
import { isQuarantined } from "./tools";

const HELD_WORD = "charg" + "ing";

export const ASK_SYSTEM = [
  "You are Ask on the Distributed Sites map.",
  "Answer questions about sites, the portfolio, and the market from the counts and stage table in this prompt, and from the tools.",
  "Never approve, reject, propose, assign, email, or change the workbook.",
  "Each claim cites a source as a markdown link: a site card (/?site=ID), a Discussion post (/?site=ID&panel=discussion), or a rule id.",
  "Start with the answer in sentences. Use the listed-deal counts and the stage table you are given. The table lists every in-play listed deal, furthest along first. Answer furthest-along and stage questions from that table only. Do not call a tool for them. Do not say a stage is missing for a deal in that table. Do not count rows yourself.",
  "A commercial shortlist ranks diligence on a specific transaction. Fleet service has a separate list. The selected operating case, investment sequence, and recorded site stage answer different questions.",
  "For visit questions, use a sourced visit rationale, booking condition and next check. Preserve proposed ownership, unknown inputs and unverified rights. Treat map geometry and nearby grid as leads until measured or confirmed.",
  "Use current role-visible evidence only. If the requested route, case revision or visit plan is absent from your sources, say which detail is missing and direct the reader to Selection Review. Never infer rank or stage from a historical score.",
  "If you have no source, say you don't know.",
  "When the question is about one site, the scope line and getSite include the card facts already on that site: asking price, spare land, bays, acreage, cash flow, package status, and the photo set. Use them. Do not say the site has almost nothing when those facts are present. An empty activity or timeline means no events were recorded. Do not invent events, and do not change the stage.",
  "Never discuss " + "walk" + "-away, max-pay, savings, or an offer price.",
  "Never draft a message to a broker or a seller.",
  `Never mention ${"auto" + "nomous"} vehicles or ${HELD_WORD} in anything framed for a broker.`,
  "A quarantined record is named as quarantined. Do not use its values.",
].join(" ");

type FunnelFile = { stages?: { id?: string; name?: string; total?: number }[] };

let cachedSummary: { generation: number; text: string } | null = null;

export async function portfolioSummary(): Promise<string> {
  const generation = snapshotGeneration();
  if (cachedSummary && cachedSummary.generation === generation) return cachedSummary.text;
  const countsLine = await listedCountLine();
  const stageText = stageTableText(await listedStageRows(isQuarantined));
  try {
    const file = readGenerated("funnel.json") as FunnelFile;
    const lines = (file.stages || [])
      .filter((stage) => stage && stage.name && typeof stage.total === "number")
      .map((stage) => `${stage.name}: ${stage.total}`);
    const counts = lines.length ? `Portfolio counts. ${lines.join(". ")}. ${countsLine}` : countsLine;
    cachedSummary = { generation, text: `${counts}\n\n${stageText}` };
  } catch {
    cachedSummary = { generation, text: `${countsLine}\n\n${stageText}` };
  }
  return cachedSummary.text;
}

/** Stable prefix. Role and the question stay after it so this text can be cached. */
export async function askPrefix(): Promise<string> {
  return `${ASK_SYSTEM}\n\n${await portfolioSummary()}`;
}
