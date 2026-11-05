import { spawn, type ChildProcess } from "node:child_process";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = 3456;
const password = process.env.E2E_PASSWORD || "e2e-pass-actions";
const hash = bcrypt.hashSync(password, 8);
const users = [
  { u: "viewer", h: hash, role: "user", actionRole: "viewer", name: "Viewer" },
  { u: "contributor", h: hash, role: "user", actionRole: "contributor", name: "Contributor" },
  { u: "reviewer", h: hash, role: "admin", actionRole: "reviewer", name: "Reviewer" },
];

async function main() {
  const db = new PGlite();
  const database = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 55433, maxConnections: 10 });
  await database.start();

  const child: ChildProcess = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    stdio: "inherit",
    env: {
      ...process.env,
      AUTH_SECRET: "e2e-auth-secret-not-for-production",
      AUTH_USERS: JSON.stringify(users),
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:55433/postgres",
      DATABASE_SSL: "disable",
      ACTION_ROLE_MAP: JSON.stringify({ admin: "reviewer", user: "contributor" }),
    },
  });

  async function shutdown() {
    child.kill("SIGTERM");
    await database.stop();
  }

  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  child.on("exit", () => {
    void database.stop().finally(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "e2e server failed");
  process.exit(1);
});
