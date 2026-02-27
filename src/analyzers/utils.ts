/**
 * Shared utilities for analyzers.
 */

/** Recursively coerce mixed tool-result content into a display string. */
export function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => toDisplayText(entry)).join(" ");
  }
  if (typeof value === "object") {
    if (
      "text" in value &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Truncate a string to `max` characters, appending "..." if trimmed. */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

/** Derive a scope identifier from an event's sidechain / agent fields. */
export function getScopeId(event: { isSidechain: boolean; agentId?: string }): string {
  return event.isSidechain ? (event.agentId ?? "unknown") : "main";
}
