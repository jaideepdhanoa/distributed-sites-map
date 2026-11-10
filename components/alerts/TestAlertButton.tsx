"use client";

import { useState } from "react";

export function TestAlertButton() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function send() {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/alerts/test", { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setPending(false);
    setMessage(payload.message || payload.error || "The test alert could not be sent.");
  }

  return (
    <div className="alert-test">
      <button type="button" className="paper-btn" onClick={() => void send()} disabled={pending} data-testid="send-test-alert">
        {pending ? "Sending…" : "Send me a test alert"}
      </button>
      {message ? <p role="status" data-testid="test-alert-result">{message}</p> : null}
    </div>
  );
}
