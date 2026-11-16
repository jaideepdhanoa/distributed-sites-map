import { stripGmailIds } from "@/lib/displayText";

const RULE_CODE = /\b[RT]-\d{2,4}\b/;
const LINE_LIMIT = 140;

function stripCodes(value: string): string {
  return value
    .replace(/\((?:[^()]|\([^()]*\))*\)/g, (group) => (RULE_CODE.test(group) ? "" : group))
    .replace(new RegExp(RULE_CODE.source, "g"), "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(\()\s+/g, "$1")
    .trim();
}

/** One plain sentence for the card, and the same note without rule codes. */
export function plainNextStep(value: string): { line: string; full: string } {
  const full = stripCodes(stripGmailIds(String(value || "")));
  if (!full) return { line: "", full: "" };
  const sentence = full.split(/(?<=[.!?])\s+/)[0] || full;
  if (sentence.length <= LINE_LIMIT) return { line: sentence, full };
  const cut = sentence.slice(0, LINE_LIMIT).replace(/\s+\S*$/, "").trim();
  return { line: `${cut || sentence.slice(0, LINE_LIMIT).trim()}…`, full };
}
