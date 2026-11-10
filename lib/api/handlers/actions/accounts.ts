import { isResponse, jsonOk, openActions } from "@/lib/actions/http";
import { safeSnapshot } from "@/lib/policy/banned";
import { getUsers } from "@/lib/users";

export async function GET() {
  const session = await openActions("viewer");
  if (isResponse(session)) return session;
  const accounts = getUsers().map((user) => ({
    id: user.u,
    name: safeSnapshot(user.displayName, 80) || user.u,
  }));
  return jsonOk({ accounts });
}
