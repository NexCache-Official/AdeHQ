/**
 * Privacy-safe bridge from inbox threads into rooms / DMs / agent context.
 * Never includes the full raw email body by default.
 */

export type EmailWorkContext = {
  emailThreadId: string;
  latestMessageId: string;
  subject: string;
  externalParticipants: string[];
  stewardSummary?: string;
  keyPoints: string[];
  /** Hard-capped excerpt of latest message. */
  excerpt: string;
  inboxDeepLink: string;
  safetyFlags: string[];
  sourceSnapshotAt: string;
  sourceSummaryVersion?: string | null;
};

export type EmailWorkProvenance = {
  sourceEmailThreadId: string;
  sourceEmailMessageId: string;
  sourceSnapshotAt: string;
  sourceSummaryVersion?: string | null;
};

export const EXCERPT_MAX_CHARS = 500;
export const KEY_POINTS_MAX = 6;
export const KEY_POINT_MAX_CHARS = 180;

export function truncateText(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trim()}…`;
}

export function buildInboxDeepLink(threadId: string): string {
  return `/inbox?thread=${encodeURIComponent(threadId)}`;
}

export function provenanceFromContext(ctx: EmailWorkContext): EmailWorkProvenance {
  return {
    sourceEmailThreadId: ctx.emailThreadId,
    sourceEmailMessageId: ctx.latestMessageId,
    sourceSnapshotAt: ctx.sourceSnapshotAt,
    sourceSummaryVersion: ctx.sourceSummaryVersion ?? null,
  };
}

export function buildEmailWorkContext(input: {
  emailThreadId: string;
  latestMessageId: string;
  subject: string;
  externalParticipants: string[];
  stewardSummary?: string | null;
  keyPoints?: string[] | null;
  latestTextBody?: string | null;
  hasAttachments?: boolean;
  sourceSnapshotAt?: string;
  sourceSummaryVersion?: string | null;
}): EmailWorkContext {
  const keyPoints = (input.keyPoints ?? [])
    .map((p) => truncateText(p, KEY_POINT_MAX_CHARS))
    .filter(Boolean)
    .slice(0, KEY_POINTS_MAX);

  const safetyFlags = ["untrusted_external"];
  if (input.hasAttachments) safetyFlags.push("has_attachments");

  return {
    emailThreadId: input.emailThreadId,
    latestMessageId: input.latestMessageId,
    subject: truncateText(input.subject || "(no subject)", 200),
    externalParticipants: input.externalParticipants
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12),
    stewardSummary: input.stewardSummary
      ? truncateText(input.stewardSummary, 400)
      : undefined,
    keyPoints,
    excerpt: truncateText(input.latestTextBody ?? "", EXCERPT_MAX_CHARS),
    inboxDeepLink: buildInboxDeepLink(input.emailThreadId),
    safetyFlags,
    sourceSnapshotAt: input.sourceSnapshotAt ?? new Date().toISOString(),
    sourceSummaryVersion: input.sourceSummaryVersion ?? null,
  };
}

/** Human-readable seeded room/DM message — never the full raw body. */
export function formatEmailWorkBridgeMessage(ctx: EmailWorkContext): string {
  const lines: string[] = [
    `**Email bridge** (untrusted external content — excerpt only)`,
    ``,
    `**Subject:** ${ctx.subject}`,
    `**Participants:** ${ctx.externalParticipants.join(", ") || "—"}`,
  ];
  if (ctx.stewardSummary) {
    lines.push(``, `**Summary:** ${ctx.stewardSummary}`);
  }
  if (ctx.keyPoints.length > 0) {
    lines.push(``, `**Key points:**`);
    for (const point of ctx.keyPoints) {
      lines.push(`- ${point}`);
    }
  }
  if (ctx.excerpt) {
    lines.push(``, `**Excerpt:**`, `> ${ctx.excerpt}`);
  }
  lines.push(
    ``,
    `Open in inbox (requires inbox access): ${ctx.inboxDeepLink}`,
    ``,
    `_Snapshot: ${ctx.sourceSnapshotAt}_`,
  );
  return lines.join("\n");
}
