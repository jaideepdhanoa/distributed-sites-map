import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
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
  return (
    <main className="card" style={{ margin: 40, width: "min(640px, calc(100% - 48px))" }}>
      <h1>Accounts</h1>
      <p className="note">
        Passwords live in the AUTH_USERS environment variable, not in this app. To add or reset someone,
        run <code>npm run add-user -- name</code>, paste the printed JSON into AUTH_USERS, and redeploy.
        Removing a name from that list signs them out on the next request. Queue access
        (viewer, contributor, reviewer) comes from <code>actionRole</code> on that account, or from
        <code>ACTION_ROLE_MAP</code>. The default is admin to reviewer and user to viewer.
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
      <p><Link href="/">Back to the map</Link></p>
    </main>
  );
}
