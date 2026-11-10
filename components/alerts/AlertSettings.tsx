"use client";

import { useEffect, useState } from "react";
import { ALERT_CATEGORIES, type AlertMode, type AlertPreferences } from "@/lib/alerts/preferences";

const LABELS: Record<string, string> = {
  approvals: "Approvals",
  mentions: "Mentions",
  replies: "Replies",
  flags: "Flags",
  assignments: "Assignments",
  followed: "Daily digest",
};

const CHOICES: AlertMode[] = ["instant", "digest", "off"];

export default function AlertSettings({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<AlertPreferences | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancel = false;
    fetch("/api/alerts/preferences").then(async (response) => {
      if (cancel || !response.ok) return;
      const payload = (await response.json()) as { preferences?: AlertPreferences; email?: string };
      if (!cancel) {
        setPrefs(payload.preferences || null);
        setEmail(payload.email || "");
      }
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  async function choose(key: keyof AlertPreferences, mode: AlertMode) {
    if (!prefs) return;
    const next = { ...prefs, [key]: mode };
    setPrefs(next);
    setError("");
    const response = await fetch("/api/alerts/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!response.ok) setError("Those settings could not be saved.");
  }

  return (
    <div className="popover alert-sheet" role="dialog" aria-label="Alert settings" data-testid="alert-settings">
      <div className="popover-head">
        <h2>Alert settings</h2>
        <button type="button" className="close" aria-label="Close alerts" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <p className="note alert-mail">{email ? `Mail goes to ${email}.` : "No mailbox is set for this account."}</p>
      {prefs ? (
        <>
          {ALERT_CATEGORIES.map((key) => (
            <div className="alert-row" key={key}>
              <span>{LABELS[key]}</span>
              <span className="alert-modes" role="group" aria-label={LABELS[key]}>
                {CHOICES.map((mode) => (
                  <button key={mode} type="button" className={prefs[key] === mode ? "chip on" : "chip"} onClick={() => void choose(key, mode)}>
                    {mode === "instant" ? "Instant" : mode === "digest" ? "Digest" : "Off"}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <div className="alert-row">
            <span>{LABELS.followed}</span>
            <span className="alert-modes" role="group" aria-label="Daily digest">
              <button type="button" className={prefs.followed === "off" ? "chip" : "chip on"} onClick={() => void choose("followed", "digest")}>On</button>
              <button type="button" className={prefs.followed === "off" ? "chip on" : "chip"} onClick={() => void choose("followed", "off")}>Off</button>
            </span>
          </div>
          <p className="note">Instant mail is batched for about five minutes. The digest is 7:00 AM Pacific, and it is skipped when there is nothing to report.</p>
        </>
      ) : <p className="note">Loading</p>}
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}
