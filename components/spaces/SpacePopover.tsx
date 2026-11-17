"use client";

import { useEffect, useState } from "react";
import { MentionChips, MentionField, type MentionAccount } from "../actions/MentionField";
import "../actions/actions.css";
import { formatPacific } from "@/lib/actions/time";
import { formatArea, formatFeet } from "@/lib/spaces/measure";
import { estimateLabel, estimateSlots } from "@/lib/spaces/slots";
import { requestCommentAnchor } from "@/lib/comments/nav";
import { SPACE_LAYOUTS, SPACE_TYPES, spaceLayout, spaceTypeLabel, type SpaceLayout, type SpaceType } from "@/lib/spaces/vocab";
import CommentThread from "../comments/CommentThread";
import type { GroundBox } from "@/lib/spaces/measure";

export type SpaceShape = {
  id: string;
  siteId: string;
  version: number;
  box: GroundBox;
  type: SpaceType;
  layout: SpaceLayout;
  estSlots: number;
  status: "estimated" | "verified";
  author: string;
};

const CAUTION = "Aerial imagery can be months old and slightly skewed. Counts stay Estimated until someone checks them on the ground.";

export default function SpacePopover({
  space,
  names,
  threadOpen = false,
  onChange,
  onClose,
  onThreadClose,
}: {
  space: SpaceShape;
  names: Record<string, string>;
  threadOpen?: boolean;
  onChange: (next: SpaceShape) => void;
  onClose: () => void;
  onThreadClose?: () => void;
}) {
  const count = estimateSlots(space.box.lengthFt, space.box.widthFt, space.layout);
  const unit = spaceLayout(space.layout).unit;
  const status = space.status === "verified" ? "Verified" : "Estimated";
  return (
    <div className="space-popover" data-testid="space-popover" role="dialog" aria-label="Marked space">
      <div className="space-popover-bar">
        <p className="eyebrow">Marked space</p>
        <button type="button" className="close" aria-label="Close marked space" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <div className="space-types" role="group" aria-label="Space type">
        {SPACE_TYPES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={space.type === item.id ? "chip on" : "chip"}
            aria-pressed={space.type === item.id}
            onClick={() => onChange({ ...space, type: item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="space-measure" data-testid="space-measure">
        {formatFeet(space.box.lengthFt)} ft × {formatFeet(space.box.widthFt)} ft · {formatArea(space.box.lengthFt * space.box.widthFt)}
      </p>
      <label className="space-layout">
        Layout
        <select
          className="secondary"
          aria-label="Layout"
          data-testid="space-layout"
          value={space.layout}
          onChange={(event) => onChange({ ...space, layout: event.target.value as SpaceLayout })}
        >
          {SPACE_LAYOUTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <p className="space-estimate" data-testid="space-estimate">{status === "Verified" ? "Verified" : estimateLabel(count, unit)}</p>
      <p className="note">Marked by {names[space.author] || space.author || "you"}</p>
      <p className="note" data-testid="space-caution">{CAUTION}</p>
      <div className="act-row">
        <button
          type="button"
          className="menu-item"
          data-testid="space-comment"
          onClick={() => requestCommentAnchor({
            type: "space",
            siteId: space.siteId,
            line: "",
            period: "",
            spaceId: space.id,
            label: spaceTypeLabel(space.type),
          })}
        >
          Comment
        </button>
      </div>
      <SpaceThread spaceId={space.id} />
      {threadOpen ? (
        <CommentThread
          siteId={space.siteId}
          anchor={{ type: "space", siteId: space.siteId, line: "", period: "", spaceId: space.id, label: spaceTypeLabel(space.type) }}
          variant="sheet"
          source="Map"
          onClose={onThreadClose}
        />
      ) : null}
    </div>
  );
}

function SpaceThread({ spaceId }: { spaceId: string }) {
  const [accounts, setAccounts] = useState<MentionAccount[]>([]);
  const [notes, setNotes] = useState<{ id: string; body: string; authorId: string; createdAt: string; mentions: MentionAccount[] }[]>([]);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<MentionAccount[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function load() {
    const response = await fetch(`/api/actions/notes?targetKind=site_space&targetId=${encodeURIComponent(spaceId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { notes?: { id: string; body: string; authorId: string; createdAt: string; mentions?: MentionAccount[]; deleted?: boolean }[] };
    setNotes((payload.notes || []).filter((note) => note.body && !note.deleted).map((note) => ({
      id: note.id,
      body: note.body,
      authorId: note.authorId,
      createdAt: note.createdAt,
      mentions: note.mentions || [],
    })));
  }

  useEffect(() => {
    void fetch("/api/actions/accounts", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { accounts: [] })
      .then((payload: { accounts?: MentionAccount[] }) => setAccounts(payload.accounts || []))
      .catch(() => setAccounts([]));
    void load();
  }, [spaceId]);

  return (
    <section className="act" data-testid="space-thread">
      <div className="act-threads">
        {notes.map((note) => (
          <article key={note.id} className="act-thread" data-testid="space-note">
            <p className="note-copy">{note.body}</p>
            {note.mentions.length ? <p className="note">Mentioned <MentionChips mentions={note.mentions} /></p> : null}
            <p className="note"><strong>{accounts.find((account) => account.id === note.authorId)?.name || note.authorId}</strong> · {formatPacific(note.createdAt)}</p>
          </article>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim() || pending) return;
          setPending(true);
          setError("");
          void fetch("/api/actions/notes", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetKind: "site_space", targetId: spaceId, body, mentions: mentions.map((item) => item.id) }),
          }).then(async (response) => {
            if (!response.ok) {
              const payload = await response.json().catch(() => ({})) as { error?: string };
              throw new Error(payload.error || "That comment could not be saved.");
            }
            setBody("");
            setMentions([]);
            await load();
          }).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "That comment could not be saved.");
          }).finally(() => setPending(false));
        }}
      >
        <MentionField
          label=""
          placeholder="Comment or @mention…"
          value={body}
          onChange={setBody}
          mentions={mentions}
          onMentions={setMentions}
          accounts={accounts}
          testId="space-note-body"
          rows={3}
          maxLength={2000}
        />
        <p className="hint">Type @ to mention someone.</p>
        <div className="act-row">
          <button type="submit" className="menu-item" disabled={pending}>Comment</button>
        </div>
      </form>
      {error ? <p className="note" role="alert">{error}</p> : null}
    </section>
  );
}
