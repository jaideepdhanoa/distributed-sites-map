"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { canReview, openPanel, useActionStatus } from "./panel";

import { rememberSearch } from "@/lib/navSearch";
import ComparisonDecision from "./ComparisonDecision";
import type { ComponentProps } from "react";
type Props = Omit<ComponentProps<typeof ComparisonDecision>, "view"> & { query: () => string };
export default function SaveComparison({ query, ...decisionProps }: Props) {

  const { actionRole } = useActionStatus();
  const [team,setTeam] = useState(false);
  const params = useSearchParams();
  const savedId = params.get("savedView");
  const [reopened, setReopened] = useState<{ id: string; name: string; query: string } | null>(null);
  useEffect(() => {
    if (!savedId) return;
    const controller = new AbortController();
    fetch("/api/actions/views", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const views = (await response.json()).views as { id: string; name: string; query: string }[];
      if (!controller.signal.aborted) setReopened(views.find(view => view.id === savedId) || null);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [savedId]);
  const current = new URLSearchParams(params.toString());
  for (const key of ["savedView", "site", "panel", "sheet", "measure", "reviewCitation"]) current.delete(key);
  const restored = reopened && reopened.id === savedId && new URLSearchParams(reopened.query).toString() === current.toString() ? reopened.name : "";
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<{ id: string; name: string; context: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const receipt = useRef({ body: "", key: "" });
  const sending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || sending.current) return;
    const body = JSON.stringify({ name: name.trim(), query: query(), scope: canReview(actionRole) && team ? "team" : "personal" });
    if (receipt.current.body !== body) receipt.current = { body, key: crypto.randomUUID() };
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/actions/views", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": receipt.current.key }, body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the comparison.");
      const verify = await fetch("/api/actions/views", { cache: "no-store" });
      if (!verify.ok || !(await verify.json()).views?.some((v: { id: string }) => v.id === data.view.id)) throw new Error("Could not confirm the save. Try again.");
      setSaved({ id: data.view.id, name: data.view.name, context: current.toString() });
      const link = new URLSearchParams(data.view.query);
      link.set("savedView", data.view.id);
      const href = "/?" + link;
      rememberSearch(href);
      window.history.replaceState(null, "", href);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the comparison. Try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const shown = restored || (saved?.context === current.toString() ? saved.name : "");
  const view = restored ? reopened?.id : saved?.id;
  if (shown && view) return <><span className="comparison-receipt" role="status">Live comparison · {shown} <button className="text-link" type="button" onClick={() => openPanel("views")}>Saved views</button></span><ComparisonDecision key={view} view={view} {...decisionProps} /></>;
  if (!editing) return <button className="paper-btn" type="button" onClick={() => setEditing(true)}>Save comparison</button>;
  return <form className="comparison-save" aria-label="Save comparison" onSubmit={submit}>
    <label>Comparison name<input autoFocus required className="field" maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
    <small>Opens with the latest figures.</small>
    {canReview(actionRole) && <label className="act-check"><input type="checkbox" className="check" checked={team} disabled={busy} onChange={event=>setTeam(event.target.checked)} />Share with the team</label>}
    <button className="primary" disabled={busy || !name.trim()} type="submit">{busy ? "Saving…" : "Save"}</button>
    <button className="text-link" disabled={busy} type="button" onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
