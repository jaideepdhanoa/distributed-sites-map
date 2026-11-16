function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Keys and types only. Array order is ignored so a photo reorder is not a type change. */
export function typeTree(value: unknown): unknown {
  const kind = valueKind(value);
  if (kind === "array" && Array.isArray(value)) {
    const items = value.map(typeTree);
    items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return ["array", items];
  }
  if (kind === "object" && value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) out[key] = typeTree((value as Record<string, unknown>)[key]);
    return out;
  }
  return kind;
}

function walk(left: unknown, right: unknown, path: string, out: string[]) {
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray || rightArray) {
    if (!leftArray || !rightArray || left[0] !== "array" || right[0] !== "array") {
      out.push(`${path} shape`);
      return;
    }
    const leftItems = left[1] as unknown[];
    const rightItems = right[1] as unknown[];
    if (leftItems.length !== rightItems.length) out.push(`${path} length ${leftItems.length}->${rightItems.length}`);
    const count = Math.min(leftItems.length, rightItems.length);
    for (let index = 0; index < count; index += 1) walk(leftItems[index], rightItems[index], `${path}[]`, out);
    return;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left as object);
    const rightRecord = right as Record<string, unknown>;
    const leftRecord = left as Record<string, unknown>;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) out.push(`missing ${path}.${key}`);
      else walk(leftRecord[key], rightRecord[key], `${path}.${key}`, out);
    }
    for (const key of Object.keys(rightRecord)) {
      if (!Object.prototype.hasOwnProperty.call(leftRecord, key)) out.push(`extra ${path}.${key}`);
    }
    return;
  }
  if (left !== right) out.push(`${path} ${String(left)}->${String(right)}`);
}

/** Differences between two values, described as keys and types. Values are never included. */
export function typeMismatches(left: unknown, right: unknown, path = "feature"): string[] {
  const out: string[] = [];
  walk(typeTree(left), typeTree(right), path, out);
  return out;
}
