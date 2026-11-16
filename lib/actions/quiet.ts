let down = false;
let knownUp = false;
let gate: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

export function actionsDown() {
  return down;
}

export function subscribeActionsDown(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

function dead() {
  return new Response(JSON.stringify({ error: "Unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

/** One failed actions read stops the rest, so a dead preview does not retry in a loop. */
export function quietActionsFetch(url: string, init?: RequestInit): Promise<Response> {
  if (down) return Promise.resolve(dead());
  if (knownUp) return fetch(url, init);
  const turn = gate.then(async () => {
    if (down) return dead();
    const response = await fetch(url, init);
    if (response.status === 503) {
      down = true;
      notify();
    } else if (response.ok) {
      knownUp = true;
    }
    return response;
  });
  gate = turn.then(() => undefined, () => undefined);
  return turn;
}
