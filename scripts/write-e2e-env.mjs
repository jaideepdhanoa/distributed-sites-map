import fs from "node:fs";
import bcrypt from "bcryptjs";

const username = process.env.E2E_USERNAME || "";
const password = process.env.E2E_PASSWORD || "";
if (!username || !password) {
  console.error("E2E_USERNAME and E2E_PASSWORD are required");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 8);
const users = JSON.stringify([{ u: username, h: hash, role: "user" }]).replaceAll("$", "\\$");
fs.writeFileSync(".env.local", `AUTH_SECRET=ci-e2e-secret\nAUTH_USERS=${users}\n`);
console.log("Wrote local sign-in for the browser test");
