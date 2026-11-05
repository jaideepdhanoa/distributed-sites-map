"use client";

import { useSyncExternalStore } from "react";

export type ActionRole = "viewer" | "contributor" | "reviewer";
export type PanelName = "suggestions" | "views" | null;

type Status = { enabled: boolean; actionRole: ActionRole; username: string };

let panel: PanelName = null;
const panelListeners = new Set<() => void>();
let status: Status = { enabled: false, actionRole: "viewer", username: "" };
let statusState: "idle" | "loading" | "ready" = "idle";
const statusListeners = new Set<() => void>();

function emitPanel() {
  for (const listener of panelListeners) listener();
}

function emitStatus() {
  for (const listener of statusListeners) listener();
}

export function openPanel(next: PanelName) {
  panel = next;
  emitPanel();
}

export function usePanel(): PanelName {
  return useSyncExternalStore(
    (listener) => {
      panelListeners.add(listener);
      return () => panelListeners.delete(listener);
    },
    () => panel,
    () => null,
  );
}

function loadStatus() {
  if (statusState !== "idle") return;
  statusState = "loading";
  fetch("/api/actions/status")
    .then(async (response) => {
      if (!response.ok) return { enabled: false, actionRole: "viewer" as const, username: "" };
      return (await response.json()) as Status;
    })
    .then((next) => {
      status = { enabled: Boolean(next.enabled), actionRole: next.actionRole || "viewer", username: next.username || "" };
      statusState = "ready";
      emitStatus();
    })
    .catch(() => {
      status = { enabled: false, actionRole: "viewer", username: "" };
      statusState = "ready";
      emitStatus();
    });
}

export function useActionStatus(): Status {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      loadStatus();
      return () => statusListeners.delete(listener);
    },
    () => status,
    () => ({ enabled: false, actionRole: "viewer", username: "" }),
  );
}

export function canWrite(role: ActionRole): boolean {
  return role === "contributor" || role === "reviewer";
}

export function canReview(role: ActionRole): boolean {
  return role === "reviewer";
}
