import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { gapNoteId } from "@/lib/actions/gapReference";
import { rememberSearch } from "@/lib/navSearch";

export default function GapThreadLink({ targetId, reason }: { targetId: string; reason: string }) {
  const params = useSearchParams();
  const note = gapNoteId(targetId, reason);
  if (!note) return null;
  const query = new URLSearchParams(params.toString());
  query.set("site", targetId);
  query.set("panel", "discussion");
  query.set("note", note);
  const href = "/?" + query;
  return <Link className="text-link" href={href} scroll={false} prefetch={false}
    onNavigate={() => rememberSearch(href)}>Open evidence thread</Link>;
}
