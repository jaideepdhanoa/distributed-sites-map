import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { askUsage, type AskUsage } from "@/lib/ask/usage";
import { actionsEnabled, withSql } from "@/lib/actions/db";
import { migrate, whenReady } from "@/lib/actions/migrate";
import { resolveActionRole } from "@/lib/actions/roles";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { getUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  if (session.role !== "admin") {
    return (
      <main className="card" style={{ margin: 40 }}>
        <h1>Accounts</h1>
        <p>Only an admin can open this page. Everyone else sees the same map.</p>
        <p><Link href="/">Back</Link></p>
      </main>
    );
  }
  const users = getUsers();
  let usage: AskUsage | null = null;
  if (actionsEnabled()) {
    try {
      await whenReady(() => withSql(async (sql) => {
        await migrate(sql);
      }));
      usage = await withSql((sql) => askUsage(sql));
    } catch {
      usage = null;
    }
  }
  return (
    <main className="card" style={{ margin: 40, width: "min(640px, calc(100% - 48px))" }}>
      <h1>Accounts</h1>
      <p className="note">
        Passwords live in the AUTH_USERS environment variable, not in this app. To add or reset someone,
        run <code>npm run add-user -- name</code>, paste the printed JSON into AUTH_USERS, and redeploy.
        Removing a name from that list signs them out on the next request. Queue access
        (viewer, contributor, reviewer) comes from <code>actionRole</code> on that account, or from
        <code>ACTION_ROLE_MAP</code>. The default is admin to reviewer and user to contributor.
      </p>
      <table>
        <thead>
          <tr><th>Username</th><th>Role</th><th>Access</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.u}>
              <td>{user.u}</td>
              <td>{user.role}</td>
              <td>{resolveActionRole(user)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Ask</h2>
      {usage ? (
        <>
          <p className="note">Month to date, estimated: ${usage.monthCost.toFixed(2)}</p>
          <table>
            <thead>
              <tr><th>User</th><th>Day</th><th>Questions</th><th>Estimated cost</th></tr>
            </thead>
            <tbody>
              {usage.days.length ? usage.days.map((row) => (
                <tr key={`${row.userId}-${row.day}`}>
                  <td>{row.userId}</td>
                  <td>{row.day}</td>
                  <td>{row.questions}</td>
                  <td>${row.cost.toFixed(4)}</td>
                </tr>
              )) : (
                <tr><td colSpan={4}>No Ask usage yet.</td></tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <p className="note">Ask usage appears here once the database is connected.</p>
      )}
      <p><Link href="/admin/alerts">Alerts admin</Link> · <Link href="/">Back to the map</Link></p>
    </main>
  );
}
