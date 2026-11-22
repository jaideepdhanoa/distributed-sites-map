import { coveredSites, counterpartyLine, queueCourt, type NdaAgreement } from "./nda";

const BROKER_BANNED = /\b(?:avs?|charging|chargers?)\b/i;

/** A follow-up a person can copy. It never sends mail and never names the product. */
export function brokerFollowUp(row: Pick<NdaAgreement, "nda_id" | "site_ids" | "nda_status" | "nda_waiting_on" | "counterparty_firm" | "counterparty_person">): string {
  const sites = coveredSites(row.site_ids || "");
  const covered = sites.ids.length ? sites.ids.join(", ") : "the sites on this agreement";
  const party = counterpartyLine(row);
  const hello = party ? `Hello ${party.split(" · ")[0]},` : "Hello,";
  const text = [
    hello,
    "",
    `Following up on ${row.nda_id}.`,
    `Covered sites: ${covered}.`,
    `Status: ${row.nda_status || "open"}.`,
    `Court: ${queueCourt(row)}.`,
    "Please reply with the next step when you can.",
    "",
    "Thank you",
  ].join("\n");
  if (BROKER_BANNED.test(text)) throw new Error("The follow-up draft used a banned word.");
  return text;
}

export function draftMentionsProduct(text: string): boolean {
  return BROKER_BANNED.test(text);
}
