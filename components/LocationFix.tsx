"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A missing map point. A reviewer can save an address or coordinates.
 * A contributor proposes the same facts as a comment.
 */
export function LocationFix({
  id,
  mode,
  address,
  lat,
  lng,
}: {
  id: string;
  mode: "edit" | "propose";
  address: string;
  lat?: number | null;
  lng?: number | null;
}) {
  const root = useRef<HTMLElement>(null);
  const [street, setStreet] = useState(address || "");
  const [latitude, setLatitude] = useState(lat == null || Number.isNaN(lat) ? "" : String(lat));
  const [longitude, setLongitude] = useState(lng == null || Number.isNaN(lng) ? "" : String(lng));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    root.current?.scrollIntoView({ block: "nearest" });
    const field = root.current?.querySelector("input, textarea");
    if (field instanceof HTMLElement) field.focus();
  }, []);

  async function saveEdit() {
    const payload: Record<string, string | number> = {};
    if (street.trim()) payload.address = street.trim();
    if (latitude.trim()) payload.lat = Number(latitude);
    if (longitude.trim()) payload.lng = Number(longitude);
    if (!Object.keys(payload).length) {
      setMessage("Add an address or coordinates.");
      return;
    }
    setPending(true);
    setMessage("");
    let version = 1;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("/api/changes", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          changes: [{
            entity_type: "site",
            site_id: id,
            expected_version: version,
            source: "Desk correction",
            payload,
          }],
        }),
      });
      if (response.ok) {
        setMessage("Location saved.");
        setPending(false);
        return;
      }
      const body = await response.json().catch(() => ({})) as { error?: string; conflicts?: { actual_version?: number }[] };
      const actual = body.conflicts?.[0]?.actual_version;
      if (response.status === 409 && typeof actual === "number" && attempt === 0) {
        version = actual;
        continue;
      }
      setMessage(body.error || "That location could not be saved.");
      setPending(false);
      return;
    }
  }

  async function propose() {
    const body = note.trim();
    if (!body) {
      setMessage("Write the address or coordinates.");
      return;
    }
    setPending(true);
    setMessage("");
    const response = await fetch("/api/actions/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetKind: "site", targetId: id, body: `Proposed location: ${body}` }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setMessage(payload.error || "That comment could not be saved.");
      return;
    }
    setNote("");
    setMessage("Location proposed.");
  }

  return (
    <section ref={root} id="location-fix" className="location-fix" data-testid="location-fix" data-mode={mode}>
      <h3>Location</h3>
      {mode === "edit" ? (
        <form onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}>
          <label>
            Address
            <input className="field" name="address" data-testid="location-address" value={street} onChange={(event) => setStreet(event.target.value)} />
          </label>
          <label>
            Latitude
            <input className="field" name="lat" inputMode="decimal" data-testid="location-lat" value={latitude} onChange={(event) => setLatitude(event.target.value)} />
          </label>
          <label>
            Longitude
            <input className="field" name="lng" inputMode="decimal" data-testid="location-lng" value={longitude} onChange={(event) => setLongitude(event.target.value)} />
          </label>
          <button type="submit" className="paper-btn" disabled={pending}>Save location</button>
        </form>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void propose(); }}>
          <label>
            Propose a location
            <textarea className="field" name="location" data-testid="location-proposal" rows={2} maxLength={400} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button type="submit" className="paper-btn" disabled={pending}>Propose</button>
        </form>
      )}
      {message ? <p className="note" role="status">{message}</p> : null}
    </section>
  );
}
