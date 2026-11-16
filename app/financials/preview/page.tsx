import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import PnlPreview from "@/components/PnlPreview";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PnlPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) notFound();
  return <PnlPreview />;
}
