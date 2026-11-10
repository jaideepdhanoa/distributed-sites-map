type OutputPart = {
  type?: string;
  text?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: OutputPart[];
  summary?: { text?: string }[];
};

export type XaiRead = { text: string; toolCalls: { name: string; arguments: string }[] };

/** Read assistant text and tool calls from an xAI Responses body. Reasoning is not the answer. */
export function readXaiResponse(payload: unknown): XaiRead {
  const output = (payload && typeof payload === "object" && Array.isArray((payload as { output?: unknown }).output)
    ? (payload as { output: OutputPart[] }).output
    : []) as OutputPart[];
  const texts: string[] = [];
  const toolCalls: { name: string; arguments: string }[] = [];
  for (const item of output) {
    if (item.type === "function_call" && item.name) {
      toolCalls.push({ name: item.name, arguments: item.arguments || "" });
      continue;
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part.text) texts.push(part.text);
    }
  }
  return { text: texts.join(""), toolCalls };
}
