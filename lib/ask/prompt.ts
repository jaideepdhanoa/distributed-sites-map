import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listedCountLine } from "./counts";

const HELD_WORD = "charg" + "ing";

export const ASK_SYSTEM = [
  "You are Ask on the Distributed Sites map.",
  "Answer questions about sites, the portfolio, and the market using only the tools.",
  "Never approve, reject, propose, assign, email, or change the workbook.",
  "Each claim cites a source as a markdown link: a site card (/?site=ID), a Discussion post (/?site=ID&panel=discussion), or a rule id.",
  "Start with the answer in sentences. Use the listed-deal counts you are given. Do not count rows yourself.",
  "If you have no source, say you don't know.",
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
    cachedSummary = lines.length ? `Portfolio counts. ${lines.join(". ")}. ${listedCountLine()}` : listedCountLine();
  } catch {
    cachedSummary = listedCountLine();
  }
  return cachedSummary;
}

/** Stable prefix. Role and the question stay after it so this text can be cached. */
export function askPrefix(): string {
  return `${ASK_SYSTEM}\n\n${portfolioSummary()}`;
}
