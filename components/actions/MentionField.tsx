"use client";

import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";

export type MentionAccount = { id: string; name: string };

const AT_QUERY = /(^|\s)@([^\s@]*)$/;

export function MentionChips({ mentions }: { mentions?: MentionAccount[] }) {
  if (!mentions?.length) return null;
  return (
    <span className="mention-chips">
      {mentions.map((item) => (
        <span key={item.id} className="mention-chip" data-testid="mention-chip">{item.name}</span>
      ))}
    </span>
  );
}

export function MentionField({
  label,
  value,
  onChange,
  mentions,
  onMentions,
  accounts,
  testId,
  rows,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mentions: MentionAccount[];
  onMentions: (mentions: MentionAccount[]) => void;
  accounts: MentionAccount[];
  testId: string;
  rows?: number;
  maxLength: number;
  placeholder?: string;
}) {
  const caret = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = `${testId}-mentions`;
  const choices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return accounts
      .filter((account) => !mentions.some((item) => item.id === account.id))
      .filter((account) => !needle || account.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [accounts, mentions, query]);

  function look(text: string, at: number) {
    caret.current = at;
    const match = text.slice(0, at).match(AT_QUERY);
    if (!match) {
      setOpen(false);
      setQuery("");
      return;
    }
    setQuery(match[2]);
    setOpen(true);
    setActive(0);
  }

  function choose(account: MentionAccount) {
    const at = caret.current;
    const match = value.slice(0, at).match(AT_QUERY);
    if (match) {
      const start = at - match[2].length - 1;
      onChange(`${value.slice(0, start)}${value.slice(at)}`);
    }
    if (!mentions.some((item) => item.id === account.id)) onMentions([...mentions, account]);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(choices.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && choices[active]) {
      event.preventDefault();
      choose(choices[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const fieldProps = {
    "data-testid": testId,
    value,
    maxLength,
    "aria-expanded": open,
    "aria-controls": listId,
    "aria-autocomplete": "list" as const,
    onChange: (event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(event.target.value);
      look(event.target.value, event.target.selectionStart ?? event.target.value.length);
    },
    onClick: (event: MouseEvent<HTMLTextAreaElement | HTMLInputElement>) => look(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length),
    onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Escape") return;
      look(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
    },
    onKeyDown,
  };

  return (
    <div className="mention-field">
      <label>
        {label}
        {rows ? <textarea {...fieldProps} rows={rows} placeholder={placeholder} /> : <input {...fieldProps} placeholder={placeholder} />}
      </label>
      {mentions.length ? (
        <span className="mention-chips">
          {mentions.map((item) => (
            <span key={item.id} className="mention-chip" data-testid="mention-chip">
              {item.name}
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onMentions(mentions.filter((mention) => mention.id !== item.id))}>×</button>
            </span>
          ))}
        </span>
      ) : null}
      {open ? (
        <div className="mention-menu" id={listId} role="listbox" data-testid="mention-menu">
          {choices.length ? choices.map((account, index) => (
            <button
              key={account.id}
              type="button"
              role="option"
              aria-selected={index === active}
              data-testid="mention-option"
              className={index === active ? "on" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(account)}
            >
              {account.name}
            </button>
          )) : <p className="note">No matching account.</p>}
        </div>
      ) : null}
    </div>
  );
}
