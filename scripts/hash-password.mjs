import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
let username = "";
let password = "";
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--user") username = String(args[i + 1] || "").trim().toLowerCase();
  else if (!args[i].startsWith("--") && !password) password = args[i];
}

const generated = !password;
if (!password) password = randomBytes(12).toString("base64url").slice(0, 16);
const hash = bcrypt.hashSync(password, 12);

if (generated) {
  console.log("Password (shown once):");
  console.log(password);
  console.log("");
}
if (username) {
  const role = username === "jaideep" ? "admin" : "user";
  console.log("Add this object to AUTH_USERS, then redeploy:");
  console.log(JSON.stringify({ u: username, h: hash, role }));
} else {
  console.log(hash);
}
