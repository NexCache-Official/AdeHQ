import type { RoomMessage } from "@/lib/types";
import { stripInternalRefs } from "@/lib/artifacts/intelligence";

const HIDDEN_SENDERS = /^(adehq|workspace|system|app)$/i;

export function sanitizeSummaryText(text: string): string {
  return stripInternalRefs(
    text
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/source topic summary id:/i.test(trimmed)) return false;
        if (/source (file|chunk|artifact) id:/i.test(trimmed)) return false;
        return true;
      })
      .join("\n"),
  );
}

export function sanitizeDisplayText(text: string): string {
  return stripInternalRefs(text);
}

function isHiddenSender(name: string): boolean {
  const first = name.split(/\s+/)[0] ?? name;
  return HIDDEN_SENDERS.test(first) || HIDDEN_SENDERS.test(name);
}

export function sourceLabelFromMessage(
  messageId: string | undefined,
  messages: Pick<RoomMessage, "id" | "senderName" | "senderType">[],
  style: "chip" | "short" = "chip",
): string | null {
  if (!messageId) return null;
  const message = messages.find((m) => m.id === messageId);
  if (!message?.senderName || isHiddenSender(message.senderName)) return null;

  const firstName = message.senderName.split(/\s+/)[0] ?? message.senderName;
  if (message.senderType === "human") {
    return style === "short" ? `${firstName}'s request` : `From ${firstName}'s request`;
  }
  return style === "short" ? `${firstName}'s reply` : `From ${firstName}'s reply`;
}

export function memorySuggestionTitle(text: string): string {
  const line = stripInternalRefs(text.split("\n").find((l) => l.trim())?.trim() ?? text.trim());
  if (line.length <= 72) return line;
  return `${line.slice(0, 69).trim()}…`;
}

export function memoryScopeLabel(scope: string, topicTitle?: string): string {
  switch (scope) {
    case "workspace":
      return "Workspace";
    case "room":
      return "Room";
    case "topic":
      return topicTitle ?? "This topic";
    case "employee":
    case "employee_dm":
      return "Employee DM";
    case "employee_profile":
      return "Employee profile";
    default:
      return scope;
  }
}
