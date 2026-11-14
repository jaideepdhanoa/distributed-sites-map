export function StagePending({ note }: { note?: string | null }) {
  const text = String(note || "").trim();
  if (!text) return null;
  return <span className="note" data-testid="stage-pending">{text}</span>;
}
