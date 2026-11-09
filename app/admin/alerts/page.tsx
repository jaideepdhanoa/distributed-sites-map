import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TestAlertButton } from "@/components/alerts/TestAlertButton";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import "../../alerts.css";

export const dynamic = "force-dynamic";

type LogRow = {
  id: string;
  user_id: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  warning: string;
  created_at: Date | string;
};

export default async function AlertPreviewPage() {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    return (
      <main className="card" style={{ margin: 40 }}>
        <h1>Alert preview</h1>
        <p>Only an admin can open this page.</p>
        <p><Link href="/">Back</Link></p>
      </main>
    );
  }
  let rows: LogRow[] = [];
  let note = "";
  if (!actionsEnabled()) {
    note = "Alerts stay off until a database is configured.";
  } else {
    try {
      await whenReady(() => withSql(async (sql) => { await migrate(sql); }));
      const result = await withSql((sql) =>
        sql.query<LogRow>(
          `SELECT id, user_id, to_email, subject, body, status, warning, created_at
           FROM alert_log WHERE status IN ('would_send', 'capped')
           ORDER BY created_at DESC LIMIT 50`,
        ),
      );
      rows = result.rows;
    } catch {
      note = "The alert log could not be read.";
    }
  }
  return (
    <main className="card" style={{ margin: 40, width: "min(720px, calc(100% - 48px))" }} data-testid="alert-preview">
      <h1>Alert preview</h1>
      <p className="note">
        These rows were not sent. They appear when neither Resend nor Gmail is configured, when the account is not approved for live mail, or when the daily cap of 400 was reached.
      </p>
      {actionsEnabled() ? <TestAlertButton /> : null}
      {note ? <p>{note}</p> : null}
      {rows.length ? (
        <div className="alert-log">
          {rows.map((row) => (
            <article key={row.id} className="alert-card" data-testid="would-send">
              <strong>{row.status === "would_send" ? "would-send" : row.status}</strong>
              <span> · {row.user_id} · {row.to_email}</span>
              <p>{row.subject}</p>
              <p>{row.body}</p>
              {row.warning ? <p className="alert-warning">{row.warning}</p> : null}
            </article>
          ))}
        </div>
      ) : note ? null : <p>No would-send rows yet.</p>}
      <p><Link href="/admin">Accounts</Link> · <Link href="/">Back to the map</Link></p>
    </main>
  );
}
