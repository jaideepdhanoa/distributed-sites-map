"use client";
import { useEffect, useState } from "react";
import { isOpenAgreement, type NdaQueueItem } from "@/lib/nda";
import type { WorkRow } from "@/lib/api/handlers/actions/work";
import { pacificToday } from "@/lib/queue/today";

const labels: Record<string, string> = {
  open: "Awaiting approval",
  accepted: "Approved",
  agreed_waiting: "Waiting",
  ready: "Ready for approval",
};
export default function MyWork({
  username,
  names,
  open,
  close,
}: {
  username: string;
  names: Record<string, string>;
  open: (row: WorkRow) => void;
  close: () => void;
}) {
  const [filter, setFilter] = useState("Assigned to me");
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    async function read(url: string) {
      const r = await fetch(url, { signal: c.signal, cache: "no-store" });
      if (!r.ok) throw Error();
      return r.json();
    }
    async function refresh() {
      setBusy(true);
      const [work, agreements] = await Promise.allSettled([
        read("/api/actions/work"),
        read("/api/data/nda"),
      ]);
      if (c.signal.aborted) return;
      const items: WorkRow[] =
        work.status === "fulfilled" ? work.value.rows : [];
      if (agreements.status === "fulfilled")
        for (const nda of agreements.value.queue as NdaQueueItem[]) {
          if (
            nda.owner !== username ||
            !isOpenAgreement(nda) ||
            ["declined", "executed", "expired", "not_required"].includes(
              nda.stage,
            )
          )
            continue;
          items.push({
            id: nda.nda_id,
            site: nda.nda_id,
            title: nda.next_step || "Confirm the next NDA action",
            owner: nda.owner,
            due: nda.next_step_due,
            status: nda.nda_status,
            kind: "NDA",
          });
        }
      setErrors([
        ...(work.status === "rejected" ? ["Actions and evidence gaps"] : []),
        ...(agreements.status === "rejected" ? ["NDA follow-ups"] : []),
      ]);
      setRows(
        items.sort(
          (a, b) =>
            (a.due || "9999").localeCompare(b.due || "9999") ||
            a.title.localeCompare(b.title),
        ),
      );
      setBusy(false);
    }
    void refresh();
    const reload = () => setAttempt((n) => n + 1);
    window.addEventListener("queue-refresh", reload);
    window.addEventListener("focus", reload);
    return () => {
      c.abort();
      window.removeEventListener("queue-refresh", reload);
      window.removeEventListener("focus", reload);
    };
  }, [username, attempt]);
  const today = pacificToday();
  function matches(row: WorkRow, group: string) {
    if (group === "Team evidence gaps") return row.kind === "Evidence gap";
    if (row.owner !== username) return false;
    return group === "Overdue"
      ? Boolean(row.due && row.due < today)
      : group === "NDA follow-ups"
        ? row.kind === "NDA"
        : true;
  }
  const visible = rows.filter((row) => matches(row, filter));
  return (
    <section className="nda-pane work-hub" aria-label="My work">
      <div className="work-page">
        <header>
          <h2>My work</h2>
          <button
            className="close"
            aria-label="Return to workspace"
            type="button"
            onClick={close}
          >
            ×
          </button>
        </header>
        <nav aria-label="Work filters">
          {[
            "Assigned to me",
            "Overdue",
            "Team evidence gaps",
            "NDA follow-ups",
          ].map((group) => (
            <button
              key={group}
              className={group === filter ? "chip on" : "chip"}
              aria-pressed={group === filter}
              type="button"
              onClick={() => setFilter(group)}
            >
              {group}
              {!busy && !errors.length && (
                <strong>
                  {rows.filter((row) => matches(row, group)).length}
                </strong>
              )}
            </button>
          ))}
        </nav>
        {!!errors.length && (
          <p role="alert">
            {errors.join(" and ")} unavailable.{" "}
            <button
              className="text-link"
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry
            </button>
          </p>
        )}
        {busy ? (
          <p role="status">Loading work…</p>
        ) : !visible.length && !errors.length ? (
          <p role="status">
            {filter === "Assigned to me"
              ? "You have no open assignments."
              : "No open items in this view."}
          </p>
        ) : null}
        <ul>
          {visible.map((row) => (
            <li key={row.kind + row.id}>
              <div>
                <small>
                  {row.kind} · {names[row.site] || row.site}
                </small>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => open(row)}
                >
                  {row.title}
                </button>
              </div>
              <div>
                <strong>{row.owner || "Unassigned"}</strong>
                <small>{labels[row.status] || row.status}</small>
              </div>
              <time data-overdue={Boolean(row.due && row.due < today)}>
                {row.due
                  ? (row.due < today ? "Overdue · " : "Due · ") + row.due
                  : "No due date"}
              </time>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
