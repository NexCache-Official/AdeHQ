import type { RoomMessage } from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strip raw UUIDs and internal reference lines from user-facing summary text. */
export function sanitizeSummaryText(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/source topic summary id:/i.test(trimmed)) return false;
      if (/source (file|chunk|artifact) id:/i.test(trimmed)) return false;
      if (UUID_RE.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(/\bmsg_[a-z0-9_-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sourceLabelFromMessage(
  messageId: string | undefined,
  messages: Pick<RoomMessage, "id" | "senderName" | "senderType">[],
): string | null {
  if (!messageId) return null;
  const message = messages.find((m) => m.id === messageId);
  if (!message?.senderName) return null;

  const firstName = message.senderName.split(/\s+/)[0] ?? message.senderName;
  if (message.senderType === "human") {
    return `From ${firstName}'s request`;
  }
  return `From ${firstName}'s reply`;
}

export function memorySuggestionTitle(text: string): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? text.trim();
  if (line.length <= 72) return line;
  return `${line.slice(0, 69).trim()}…`;
}

export function memoryScopeLabel(scope: string): string {
  switch (scope) {
    case "workspace":
      return "Workspace";
    case "room":
      return "Room";
    case "topic":
      return "Topic";
    case "employee":
      return "Employee";
    default:
      return scope;
  }
}
