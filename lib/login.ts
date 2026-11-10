import bcrypt from "bcryptjs";
import { accountEmail } from "@/lib/alerts/recipients";
import { getUsers, type AuthUser } from "@/lib/users";

const DUMMY_HASH = bcrypt.hashSync("timing-pad-not-a-password", 12);

/** Username, or the mailbox alerts use when the input contains @. */
export function findUserByLogin(input: string): AuthUser | undefined {
  const submitted = input.trim().toLowerCase();
  if (!submitted) return undefined;
  const users = getUsers();
  if (!submitted.includes("@")) return users.find((user) => user.u === submitted);
  const matches = users.filter((user) => accountEmail(user.u) === submitted);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Account name for the lockout counter. Unknown input keeps its own bucket. */
export function loginLockName(input: string): string {
  const submitted = input.trim().toLowerCase();
  return findUserByLogin(submitted)?.u || submitted;
}

export function passwordMatches(user: AuthUser | undefined, password: string): boolean {
  return bcrypt.compareSync(password, user?.h || DUMMY_HASH);
}
