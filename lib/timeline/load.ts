export const ACTIVITY_TIMEOUT_MS = 15000;

export type ActivityLoad<T> = { ok: true; value: T } | { ok: false };

export function activityView<TTimeline, TComms>(input: {
  timeline: ActivityLoad<TTimeline>;
  comms: ActivityLoad<TComms>;
}): {
  timeline: TTimeline | null;
  comms: TComms | null;
  timelineError: boolean;
  commsError: boolean;
} {
  return {
    timeline: input.timeline.ok ? input.timeline.value : null,
    comms: input.comms.ok ? input.comms.value : null,
    timelineError: !input.timeline.ok,
    commsError: !input.comms.ok,
  };
}
