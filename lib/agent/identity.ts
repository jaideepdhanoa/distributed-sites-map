export const WRITE_AGENTS = ["indie", "muse", "chatgpt"] as const;
export type WriteAgent = (typeof WRITE_AGENTS)[number];

export function isWriteAgent(id: string): id is WriteAgent {
  return WRITE_AGENTS.some((agent) => agent === id);
}

export function canCapture(id: string): boolean {
  return id === "muse" || id === "chatgpt";
}

export function canMaintainSites(id: string): boolean {
  return id === "indie" || id === "chatgpt";
}
