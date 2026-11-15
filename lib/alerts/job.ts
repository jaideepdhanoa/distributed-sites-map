import { isSession, requireUser } from "@/lib/guard";
import { bearerMatchesSecret } from "@/lib/snapshot/auth";

export async function authorizeJob(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim() || "";
  const header = request.headers.get("authorization") || "";
  if (bearerMatchesSecret(header, secret)) return true;
  try {
    const session = await requireUser();
    return isSession(session) && session.role === "admin";
  } catch {
    return false;
  }
}
