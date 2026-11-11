import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  "If you have no source, say you don't know.",
  "When the question is about one site, the scope line and getSite include the card facts already on that site: asking price, spare land, bays, acreage, cash flow, package status, and the photo set. Use them. Do not say the site has almost nothing when those facts are present. An empty activity or timeline means no events were recorded. Do not invent events, and do not change the stage.",
  "Never discuss " + "walk" + "-away, max-pay, savings, or an offer price.",
  "Never draft a message to a broker or a seller.",
  `Never mention ${"auto" + "nomous"} vehicles or ${HELD_WORD} in anything framed for a broker.`,
  "A quarantined record is named as quarantined. Do not use its values.",
].join(" ");

type FunnelFile = { stages?: { id?: string; name?: string; total?: number }[] };

let cachedSummary: string | null = null;

export function portfolioSummary(): string {
  if (cachedSummary) return cachedSummary;
  try {
    const file = JSON.parse(readFileSync(join(process.cwd(), "data", "generated", "funnel.json"), "utf8")) as FunnelFile;
    const lines = (file.stages || [])
      .filter((stage) => stage && stage.name && typeof stage.total === "number")
      .map((stage) => `${stage.name}: ${stage.total}`);
    const counts = lines.length ? `Portfolio counts. ${lines.join(". ")}. ${listedCountLine()}` : listedCountLine();
    cachedSummary = `${counts}\n\n${stageTableText(listedStageRows(isQuarantined))}`;
  } catch {
    cachedSummary = `${listedCountLine()}\n\n${stageTableText(listedStageRows(isQuarantined))}`;
  }
  return cachedSummary;
}

/** Stable prefix. Role and the question stay after it so this text can be cached. */
export function askPrefix(): string {
  return `${ASK_SYSTEM}\n\n${portfolioSummary()}`;
}
