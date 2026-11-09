import { isSession, requireUser } from "@/lib/guard";

export async function authorizeJob(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") || "";
  if (secret && header === `Bearer ${secret}`) return true;
  const session = await requireUser();
  return isSession(session) && session.role === "admin";
}
