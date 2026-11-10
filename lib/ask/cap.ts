import { losAngelesParts } from "@/lib/alerts/clock";
import { redisConfig } from "@/lib/lockout";

export type AskCredit = { ok: true } | { ok: false; reason: "limit" | "unconfigured" };

type Backend = { incr: (key: string) => Promise<number> };

let backend: Backend | null = null;
const memory = new Map<string, number>();

export function setAskBackend(next: Backend | null): void {
  backend = next;
  memory.clear();
}

export function askDailyLimit(): number {
  const parsed = Number(process.env.ASK_DAILY_LIMIT);
  if (!Number.isFinite(parsed) || parsed < 1) return 40;
  return Math.floor(parsed);
}

async function redisIncr(key: string): Promise<number> {
  const cfg = redisConfig();
  if (!cfg) throw new Error("ask cap store is not configured");
  const response = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["INCR", key]),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("ask cap store rejected the command");
  const payload = (await response.json()) as { result?: unknown };
  const count = Number(payload.result);
  if (count === 1) {
    await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EXPIRE", key, 60 * 60 * 48]),
      cache: "no-store",
    });
  }
  return count;
}

export async function consumeAskCredit(userId: string, now = new Date()): Promise<AskCredit> {
  if (process.env.VERCEL_ENV && !backend && !redisConfig()) return { ok: false, reason: "unconfigured" };
  const key = `ask:cap:${userId}:${losAngelesParts(now).day}`;
  let count = 0;
  if (backend) count = await backend.incr(key);
  else if (redisConfig()) count = await redisIncr(key);
  else {
    count = (memory.get(key) || 0) + 1;
    memory.set(key, count);
  }
  if (count > askDailyLimit()) return { ok: false, reason: "limit" };
  return { ok: true };
}
