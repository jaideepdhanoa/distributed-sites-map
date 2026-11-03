const WINDOW = 60 * 15;
const LIMIT = 5;

type RedisConfig = { url: string; token: string };

export function redisConfig(): RedisConfig | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function lockoutRequired(): boolean {
  return Boolean(process.env.VERCEL_ENV);
}

async function command(parts: (string | number)[]): Promise<unknown> {
  const cfg = redisConfig();
  if (!cfg) throw new Error("lockout store is not configured");
  const response = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("lockout store rejected the command");
  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
}

export async function lockStatus(username: string): Promise<"open" | "locked" | "unconfigured"> {
  if (!redisConfig()) return lockoutRequired() ? "unconfigured" : "open";
  const locked = await command(["GET", `sites:lock:${username}`]);
  return locked ? "locked" : "open";
}

export async function recordFailure(username: string): Promise<void> {
  if (!redisConfig()) return;
  const key = `sites:fail:${username}`;
  const count = Number(await command(["INCR", key]));
  if (count === 1) await command(["EXPIRE", key, WINDOW]);
  if (count >= LIMIT) await command(["SET", `sites:lock:${username}`, "1", "EX", WINDOW]);
}

export async function clearFailures(username: string): Promise<void> {
  if (!redisConfig()) return;
  await command(["DEL", `sites:fail:${username}`]);
}
