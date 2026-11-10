import { losAngelesParts } from "@/lib/alerts/clock";
import type { Sql } from "@/lib/actions/db";

export type AskUsage = {
  days: { userId: string; day: string; questions: number; cost: number }[];
  monthCost: number;
};

export async function askUsage(sql: Sql, now = new Date()): Promise<AskUsage> {
  const rows = await sql.query<{
    user_id: string;
    estimated_cost: string | number;
    created_at: Date | string;
  }>(
    `SELECT user_id, estimated_cost, created_at FROM ask_log WHERE created_at > now() - interval '40 days' ORDER BY created_at DESC LIMIT 2000`,
  );
  const month = losAngelesParts(now).day.slice(0, 7);
  const grouped = new Map<string, { userId: string; day: string; questions: number; cost: number }>();
  let monthCost = 0;
  for (const row of rows.rows) {
    const day = losAngelesParts(new Date(row.created_at)).day;
    const cost = Number(row.estimated_cost) || 0;
    if (day.startsWith(month)) monthCost += cost;
    const key = `${row.user_id}|${day}`;
    const current = grouped.get(key) || { userId: row.user_id, day, questions: 0, cost: 0 };
    current.questions += 1;
    current.cost += cost;
    grouped.set(key, current);
  }
  const days = [...grouped.values()].sort((a, b) => b.day.localeCompare(a.day) || a.userId.localeCompare(b.userId));
  return { days, monthCost: Math.round(monthCost * 1_000_000) / 1_000_000 };
}
