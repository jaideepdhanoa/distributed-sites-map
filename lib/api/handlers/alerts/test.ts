import { isResponse, jsonError, jsonOk } from "@/lib/actions/http";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { accountEmail } from "@/lib/alerts/recipients";
import { sendTestAlerts } from "@/lib/alerts/testSend";
import { isSession, requireUser } from "@/lib/guard";

export async function POST() {
  if (!actionsEnabled()) return jsonError("Alerts stay off until a database is configured.", 503);
  const session = await requireUser();
  if (!isSession(session)) return session;
  if (session.role !== "admin") return jsonError("Only an admin can send a test alert.", 403);
  const email = accountEmail(session.u);
  if (!email) return jsonError("No mailbox is set for this account.", 400);
  try {
    await whenReady(() => withSql(async (sql) => { await migrate(sql); }));
  } catch {
    return jsonError("The actions database is unavailable.", 503);
  }
  const result = await withSql((sql) => sendTestAlerts(sql, { userId: session.u, email }));
  if (result.limited) return jsonError(result.message, 429);
  if (result.delivery === "error") return jsonError(result.message, 502);
  return jsonOk({
    delivery: result.delivery,
    email: result.email,
    instant: result.instant,
    digest: result.digest,
    message: result.message,
  });
}
