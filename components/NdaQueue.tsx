"use client";

import { useEffect, useState } from "react";
import {
  clockLine,
  counterpartyLine,
  courtDayCount,
  coveredSites,
  dayCount,
  queueCourt,
  type NdaAgreement,
} from "@/lib/nda";

type Payload = {
  source?: string;
  as_of?: string;
  label?: string;
  queue?: NdaAgreement[];
  error?: string;
};

export default function NdaQueue({
  onOpen,
  onClose,
}: {
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [openId, setOpenId] = useState("");
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let cancel = false;
    fetch("/api/data/nda").then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Payload;
      if (cancel) return;
      if (!response.ok) {
        setFailed(body.error || "The NDA queue could not be loaded.");
        return;
      }
      setPayload(body);
    }).catch(() => {
      if (!cancel) setFailed("The NDA queue could not be loaded.");
    });
    return () => {
      cancel = true;
    };
  }, []);

  const rows = payload?.queue || [];

  return (
    <aside className="nda-pane" data-testid="nda-queue" aria-label="NDA queue">
      <div className="layers-bar nda-bar">
        <p className="eyebrow">NDA queue</p>
        <button type="button" className="close" aria-label="Close NDA queue" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <div className="nda-scroll">
        {payload?.label ? <p className="note">{payload.label}</p> : null}
        {failed ? <p className="note">{failed}</p> : null}
        {!failed && payload && rows.length === 0 ? <p className="note">No open NDAs.</p> : null}
        {!payload && !failed ? <p className="note">Loading</p> : null}
        <ul className="nda-list">
          {rows.map((row) => {
            const sites = coveredSites(row.site_ids || "");
            const open = openId === row.nda_id;
            const party = counterpartyLine(row);
            const clocks = clockLine(dayCount(row.nda_days_open), courtDayCount(row.nda_days_in_court));
            return (
              <li key={row.nda_id} className="nda-row" data-testid={`nda-${row.nda_id}`} data-court={queueCourt(row)}>
                <h3>{row.nda_id}{party ? ` · ${party}` : ""}</h3>
                <p className="nda-court"><span>Court</span>{queueCourt(row)}</p>
                {row.nda_status ? <p>{row.nda_status}</p> : null}
                <p>Gates: {row.nda_gates || "—"}</p>
                <p>{clocks || "—"}</p>
                <p>Last action: {row.nda_last_action_date || "—"}</p>
                {sites.ids.length ? (
                  <>
                    <button
                      type="button"
                      className="text-link"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? "" : row.nda_id)}
                    >
                      Covered sites
                    </button>
                    {open ? (
                      <div className="nda-sites">
                        {sites.ids.map((id) => (
                          <button key={id} type="button" className="text-link" onClick={() => onOpen(id)}>{id}</button>
                        ))}
                        {sites.note ? <p>{sites.note}</p> : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p>No Pipeline or Land row yet</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
