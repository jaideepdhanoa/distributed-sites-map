import { redisConfig } from "./lockout";

export async function redisCommand(parts: (string | number)[]): Promise<unknown> {
  const cfg = redisConfig();
  if (!cfg) return undefined;
  const response = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(parts),
    cache: "no-store",
  });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
}
