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
  // Also drop dangling hyphen/ellipsis leftovers after ID stripping ("send-b", "…").
  return stripInternalRefs(text)
    .replace(/\s+[a-z]-$/i, "")
    .replace(/\s+[—–-]\s*$/g, "")
    .trim();
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

/** Prefer structured record sources (CRM, task, artifact) over generic reply labels. */
export function sourceLabelForSummaryItem(
  messageId: string | undefined,
  messages: Pick<RoomMessage, "id" | "senderName" | "senderType" | "artifacts">[],
  style: "chip" | "short" = "short",
): string | null {
  if (!messageId) return null;
  const message = messages.find((m) => m.id === messageId);
  const artifacts = message?.artifacts ?? [];
  if (artifacts.length > 0) {
    const types = new Set(artifacts.map((a) => a.type));
    if (types.has("crm_contact")) return style === "short" ? "CRM contact" : "From CRM contact record";
    if (types.has("crm_deal")) return style === "short" ? "CRM deal" : "From CRM deal record";
    if (types.has("crm_company")) return style === "short" ? "CRM company" : "From CRM company record";
    if (types.has("task") || artifacts.some((a) => a.meta?.toolName === "tasks.createTask")) {
      return style === "short" ? "Task" : "From task record";
    }
    if (types.has("artifact")) return style === "short" ? "Artifact" : "From artifact";
    if (types.has("approval")) return style === "short" ? "Approval" : "From approval request";
    if (artifacts.some((a) => a.type === "tool_result" && a.meta?.toolStatus === "success")) {
      return style === "short" ? "Tool result" : "From tool execution";
    }
  }
  return sourceLabelFromMessage(messageId, messages, style);
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
