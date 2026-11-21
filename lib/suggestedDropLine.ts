import { stripGmailIds } from "./displayText";

/** One sentence-case line. A short label stays a fragment after the colon. */
export function suggestedDropPhrase(reason: string): string {
  const text = stripGmailIds(reason).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return `Suggested drop: ${fragmentCase(text)}`;
}

function fragmentCase(text: string): string {
  if (/[.!?]$/.test(text)) return text.charAt(0).toUpperCase() + text.slice(1);
  if (text === text.toUpperCase() && /[A-Z]/.test(text)) return text.toLowerCase();
  return text.charAt(0).toLowerCase() + text.slice(1);
}
