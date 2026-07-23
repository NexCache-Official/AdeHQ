import { cn } from "@/lib/utils";
import type { EmailMissionStatus } from "@/lib/inbox/mission-status";
import { EMAIL_MISSION_LABELS } from "@/lib/inbox/mission-status";

/** Compact mono status pill used in list rows + reader (Inbox.dc.html). */
export function InboxMissionPill({
  status,
  className,
}: {
  status: EmailMissionStatus | string;
  className?: string;
}) {
  const label =
    (EMAIL_MISSION_LABELS as Record<string, string>)[status] ?? String(status).replace(/_/g, " ");
  const tone =
    status === "waiting_reply" || status === "sent" || status === "queued"
      ? "success"
      : status === "awaiting_human" || status === "pending_send"
        ? "warn"
        : status === "discarded"
          ? "danger"
          : "neutral";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.05em]",
        tone === "success" && "bg-green-soft text-green",
        tone === "warn" && "bg-amber-soft text-amber",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "neutral" && "bg-muted text-ink-3",
        className,
      )}
    >
      <span
        className={cn(
          "h-[5px] w-[5px] rounded-full",
          tone === "success" && "bg-green",
          tone === "warn" && "bg-amber",
          tone === "danger" && "bg-danger",
          tone === "neutral" && "bg-ink-3",
        )}
      />
      {label}
    </span>
  );
}
