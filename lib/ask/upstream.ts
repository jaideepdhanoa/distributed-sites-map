export type UpstreamDetail = { status: number | null; body: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/** Status and response body for a provider failure. Secrets are stripped. */
export function describeUpstream(error: unknown): UpstreamDetail {
  const row = asRecord(error);
  const status = typeof row?.statusCode === "number" ? row.statusCode : null;
  let body = "";
  if (typeof row?.responseBody === "string") body = row.responseBody;
  else if (row?.data != null) body = typeof row.data === "string" ? row.data : JSON.stringify(row.data);
  else if (row?.cause) body = describeUpstream(row.cause).body;
  else if (error instanceof Error) body = error.message;
  body = body
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(sk|xai)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .slice(0, 800);
  return { status, body };
}

export function logUpstream(error: unknown): UpstreamDetail {
  const detail = describeUpstream(error);
  console.error(JSON.stringify({ event: "ask_upstream", status: detail.status, body: detail.body }));
  return detail;
}
