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

let statusAttempts = 0;

function loadStatus() {
  if (statusState === "loading") return;
  if (statusState === "ready" && status.enabled) return;
  statusState = "loading";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  fetch("/api/actions/status", { cache: "no-store", signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as Status;
    })
    .then((next) => {
      status = { enabled: Boolean(next.enabled), actionRole: next.actionRole || "viewer", username: next.username || "" };
      statusState = "ready";
      statusAttempts = 0;
      emitStatus();
    })
    .catch(() => {
      statusAttempts += 1;
      if (statusAttempts < 4) {
        statusState = "idle";
        window.setTimeout(loadStatus, 300 * statusAttempts);
        return;
      }
      status = { enabled: false, actionRole: "viewer", username: "" };
      statusState = "ready";
      emitStatus();
    })
    .finally(() => window.clearTimeout(timer));
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
