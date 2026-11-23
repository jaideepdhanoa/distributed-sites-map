"use client";

import { useEffect, useState } from "react";
import { MentionChips, MentionField, type MentionAccount } from "../actions/MentionField";
import { canReview, canWrite, useActionStatus } from "../actions/panel";
import { formatPacific } from "@/lib/actions/time";
import {
  COMMENT_TAGS,
  chipLabel,
  commentTagLabel,
  sameAnchor,
  suggestBrokerQuestion,
  type CommentAnchor,
  type CommentTag,
} from "@/lib/comments/anchor";
import { postComment } from "@/lib/comments/client";
import { COMMENT_CHANGED, notifyCommentChange } from "@/lib/comments/nav";
import { withoutGmail } from "@/lib/displayText";

export type ThreadNote = {
  id: string;
  parentId: string | null;
  body: string;
  authorId: string;
  createdAt: string;
  deleted?: boolean;
  resolvedAt: string | null;
  mentions?: MentionAccount[];
  anchor?: CommentAnchor | null;
  tag?: string;
  version?: number | null;
  brokerQuestion?: string | null;
};

function shown(note: ThreadNote): string {
  return withoutGmail(note.body);
}

export default function CommentThread({
  siteId,
  anchor,
  notes,
  variant,
  source,
  preview = false,
  compact = false,
  onClose,
  onReload,
  onCount,
}: {
  siteId: string;
  anchor: CommentAnchor;
  notes?: ThreadNote[];
  variant: "inline" | "sheet";
  source: string;
  preview?: boolean;
  compact?: boolean;
  onClose?: () => void;
  onReload?: () => void;
  onCount?: (count: number) => void;
}) {
  const status = useActionStatus();
  const [loaded, setLoaded] = useState<ThreadNote[]>(notes || []);
  const [accounts, setAccounts] = useState<MentionAccount[]>([]);
  const [draftTag, setDraftTag] = useState<CommentTag>("investigate");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<MentionAccount[]>([]);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyMentions, setReplyMentions] = useState<MentionAccount[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const writable = preview || canWrite(status.actionRole);
  const reviewer = preview || canReview(status.actionRole);

  useEffect(() => {
    if (notes) setLoaded(notes);
  }, [notes]);

  useEffect(() => {
    const noteId = new URLSearchParams(window.location.search).get("note");
    if (!noteId) return;
    const node = document.querySelector(`[data-note-id="${CSS.escape(noteId)}"]`);
    if (!(node instanceof HTMLElement)) return;
    node.scrollIntoView({ block: "center" });
  }, [loaded]);

  useEffect(() => {
    if (preview || notes) return undefined;
    let cancel = false;
    const pull = () => {
      const query = new URLSearchParams({ targetKind: "site", targetId: siteId });
      void fetch(`/api/actions/notes?${query}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : { notes: [] }))
        .then((payload: { notes?: ThreadNote[] }) => {
          if (!cancel) setLoaded(payload.notes || []);
        })
        .catch(() => undefined);
    };
    pull();
    window.addEventListener(COMMENT_CHANGED, pull);
    return () => {
      cancel = true;
      window.removeEventListener(COMMENT_CHANGED, pull);
    };
  }, [preview, notes, siteId]);

  useEffect(() => {
    if (preview) return undefined;
    void fetch("/api/actions/accounts", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { accounts: [] }))
      .then((payload: { accounts?: MentionAccount[] }) => setAccounts(payload.accounts || []))
      .catch(() => setAccounts([]));
    return undefined;
  }, [preview]);

  const roots = loaded.filter((note) => !note.parentId && note.anchor && sameAnchor(note.anchor, anchor) && !note.deleted);
  useEffect(() => {
    onCount?.(roots.length);
  }, [onCount, roots.length]);
  const name = (id: string) => accounts.find((account) => account.id === id)?.name || id;

  async function save(input: {
    expectedVersion: number;
    entityId?: string;
    parentId?: string;
    body?: string;
    tag?: CommentTag;
    mentions?: string[];
    resolved?: boolean;
    anchor?: CommentAnchor;
  }) {
    if (preview) {
      if (input.parentId) {
        setLoaded((current) => [...current, {
          id: `preview-${current.length + 1}`,
          parentId: input.parentId || null,
          body: input.body || "",
          authorId: "you",
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          anchor,
          mentions: [],
        }]);
      } else if (input.entityId) {
        setLoaded((current) => current.map((note) => (note.id === input.entityId
          ? {
              ...note,
              body: input.body ?? note.body,
              tag: input.tag ?? note.tag,
              resolvedAt: input.resolved === undefined ? note.resolvedAt : input.resolved ? new Date().toISOString() : null,
              brokerQuestion: (input.tag ?? note.tag) === "ask_broker" ? suggestBrokerQuestion(anchor) : null,
            }
          : note)));
      } else if (input.body) {
        setLoaded((current) => [...current, {
          id: `preview-${current.length + 1}`,
          parentId: null,
          body: input.body || "",
          authorId: "you",
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          anchor,
          tag: input.tag || "investigate",
          version: 1,
          mentions: [],
          brokerQuestion: input.tag === "ask_broker" ? suggestBrokerQuestion(anchor) : null,
        }]);
      }
      return true;
    }
    setPending(true);
    setError("");
    const result = await postComment({ siteId, source, ...input });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    notifyCommentChange();
    onReload?.();
    return true;
  }

  const flat = roots.flatMap((note) => {
    const replies = loaded.filter((item) => item.parentId === note.id && !item.deleted);
    return [note, ...replies];
  }).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latest = flat.slice(-2);
  const composer = writable ? (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save({ expectedVersion: 0, anchor, body, tag: draftTag, mentions: mentions.map((item) => item.id) }).then((ok) => {
          if (!ok) return;
          setBody("");
          setMentions([]);
          setDraftTag("investigate");
        });
      }}
    >
      <MentionField label="" placeholder="Comment or @mention…" value={body} onChange={setBody} mentions={mentions} onMentions={setMentions} accounts={accounts} testId="comment-body" rows={compact ? 2 : 3} maxLength={2000} />
      <p className="hint">Type @ to mention someone.</p>
      {compact ? null : (
        <div className="act-row" role="group" aria-label="Tag" data-testid="comment-tags">
          {COMMENT_TAGS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={draftTag === item.id ? "chip on" : "chip"}
              aria-pressed={draftTag === item.id}
              disabled={pending}
              onClick={() => setDraftTag(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="act-row">
        <button type="submit" className="menu-item" disabled={pending}>Comment</button>
      </div>
    </form>
  ) : <p className="note">Notes are read only for this login.</p>;
  if (compact) {
    return (
      <div className="act-threads" data-testid="comment-threads">
        {latest.length ? latest.map((note) => (
          <article key={note.id} className="act-thread" data-testid="comment-thread-item" data-note-id={note.id}>
            <div className="note-copy">{shown(note)}</div>
            <p className="note"><strong>{name(note.authorId)}</strong> · {formatPacific(note.createdAt)}</p>
            {writable ? <button type="button" className="menu-item" onClick={() => setReplyFor(note.parentId || note.id)}>Reply</button> : null}
          </article>
        )) : <p className="note">No comments yet.</p>}
        {composer}
        {replyFor ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save({ expectedVersion: 0, parentId: replyFor, body: reply, mentions: replyMentions.map((item) => item.id) }).then((ok) => {
                if (!ok) return;
                setReply("");
                setReplyMentions([]);
                setReplyFor(null);
              });
            }}
          >
            <MentionField label="Reply" value={reply} onChange={setReply} mentions={replyMentions} onMentions={setReplyMentions} accounts={accounts} testId="comment-reply" rows={2} maxLength={2000} />
            <button type="submit" className="menu-item" disabled={pending}>Reply</button>
          </form>
        ) : null}
        {error ? <p className="note" role="alert">{error}</p> : null}
      </div>
    );
  }

  const thread = (
    <div className="act-threads" data-testid="comment-threads">
      {roots.map((note) => {
        const replies = loaded.filter((item) => item.parentId === note.id && !item.deleted);
        const question = note.brokerQuestion || (note.tag === "ask_broker" ? suggestBrokerQuestion(anchor) : "");
        return (
          <article key={note.id} className="act-thread" data-testid="comment-thread-item" data-note-id={note.id}>
            <p className="note">
              <strong>{name(note.authorId)}</strong>
              {` · ${formatPacific(note.createdAt)}`}
              {note.tag ? ` · ${commentTagLabel(note.tag)}` : ""}
              {note.resolvedAt ? " · Resolved" : ""}
            </p>
            <div className="note-copy">{shown(note)}</div>
            {note.mentions?.length ? <p className="note">Mentioned <MentionChips mentions={note.mentions} /></p> : null}
            {question ? <p className="note" data-testid="broker-question">Suggested question, not sent: {question}</p> : null}
            {writable && reviewer ? (
              <div className="act-row" role="group" aria-label="Tag">
                {COMMENT_TAGS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={note.tag === item.id ? "chip on" : "chip"}
                    aria-pressed={note.tag === item.id}
                    disabled={pending}
                    onClick={() => void save({ expectedVersion: note.version || 1, entityId: note.id, tag: item.id })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {replies.length ? (
              <ul className="act-replies">
                {replies.map((item) => (
                  <li key={item.id}>
                    <div className="note-copy">{shown(item)}</div>
                    <p className="note"><strong>{name(item.authorId)}</strong> · {formatPacific(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="act-row">
              {writable && !note.resolvedAt ? <button type="button" className="menu-item" onClick={() => setReplyFor(note.id)}>Reply</button> : null}
              {reviewer && !note.resolvedAt ? <button type="button" className="menu-item" data-testid="comment-resolve" onClick={() => void save({ expectedVersion: note.version || 1, entityId: note.id, resolved: true })}>Resolve</button> : null}
              {reviewer && note.resolvedAt ? <button type="button" className="menu-item" data-testid="comment-reopen" onClick={() => void save({ expectedVersion: note.version || 1, entityId: note.id, resolved: false })}>Reopen</button> : null}
            </div>
            {replyFor === note.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({ expectedVersion: 0, parentId: note.id, body: reply, mentions: replyMentions.map((item) => item.id) }).then((ok) => {
                    if (!ok) return;
                    setReply("");
                    setReplyMentions([]);
                    setReplyFor(null);
                  });
                }}
              >
                <MentionField label="Reply" value={reply} onChange={setReply} mentions={replyMentions} onMentions={setReplyMentions} accounts={accounts} testId="comment-reply" rows={2} maxLength={2000} />
                <button type="submit" className="menu-item" disabled={pending}>Reply</button>
              </form>
            ) : null}
          </article>
        );
      })}
      {composer}
      {error ? <p className="note" role="alert">{error}</p> : null}
    </div>
  );

  if (variant === "inline") return thread;
  return (
    <section className="comment-sheet" role="dialog" aria-label="Comment thread" data-testid="comment-sheet">
      <div className="space-popover-bar">
        <p className="eyebrow" data-testid="comment-sheet-label">{chipLabel(anchor)}</p>
        <button type="button" className="close" aria-label="Close comment thread" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      {thread}
    </section>
  );
}
