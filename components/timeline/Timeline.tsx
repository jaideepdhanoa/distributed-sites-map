"use client";

import { useEffect, useState } from "react";
import "./timeline.css";

type Item = { date: string; type: string; summary: string; link: string };

const LABELS: Record<string, string> = {
  call: "Call",
  visit: "Visit",
  doc: "Document",
  email: "Email",
  brochure: "Brochure",
  om: "OM",
  financials: "Financials",
  photos: "Photos",
};

export default function Timeline({ recordId, relatedId }: { recordId: string; relatedId?: string }) {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let cancel = false;
    const query = new URLSearchParams({ id: recordId });
    if (relatedId) query.set("related", relatedId);
    fetch(`/api/data/timeline?${query}`)
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = (await response.json()) as { items?: Item[] };
        return payload.items || [];
      })
      .then((next) => {
        if (!cancel) setItems(next);
      })
      .catch(() => {
        if (!cancel) setItems([]);
      });
    return () => {
      cancel = true;
    };
  }, [recordId, relatedId]);

  return (
    <section className="tl" data-testid="activity">
      <h3>Activity</h3>
      {items === null ? <p className="note">Loading activity.</p> : null}
      {items && items.length === 0 ? <p className="note">No activity on file.</p> : null}
      {items && items.length ? (
        <ol className="tl-list">
          {items.map((item, index) => (
            <li key={`${item.date}-${item.type}-${index}`}>
              <p>
                <strong>{LABELS[item.type] || "Document"}</strong>
                {item.date ? ` · ${item.date}` : ""}
              </p>
              <p>{item.summary}</p>
              {item.link ? (
                <p><a href={item.link} target="_blank" rel="noopener noreferrer">Open</a></p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
