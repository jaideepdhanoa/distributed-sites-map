import { notFound } from "next/navigation";
import GapSheet from "@/components/GapSheet";

export const dynamic = "force-dynamic";

/** Local render of the production-shaped missing-month fixture. Not deployed. */
export default function GapPreviewPage() {
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") notFound();
  return <GapSheet />;
}
