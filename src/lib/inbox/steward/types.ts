/**
 * Slice C steward types — EmailTriageResult is the only shape UI/backends share.
 */

export const TRIAGE_VERSION = "c1";

export const DEFAULT_ASSIGN_THRESHOLD = 0.9;

export type TriageStatus =
  | "not_started"
  | "queued"
  | "running"
  | "ready"
  | "failed";

export type DraftJobStatus =
  | "idle"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancelled";

export type EmailCategory =
  | "sales"
  | "support"
  | "billing"
  | "partnership"
  | "investor"
  | "recruiting"
  | "operations"
  | "automated"
  | "newsletter"
  | "security"
  | "general";

export type EmailPriority = "low" | "normal" | "high" | "urgent";

export type AssignmentSource =
  | "thread_continuity"
  | "deterministic_rule"
  | "role_match"
  | "classifier"
  | "human";

export type EmailTriageResult = {
  category: EmailCategory;
  priority: EmailPriority;
  replyRequired: boolean;
  /** Confidence in category / priority / replyRequired / signals — NOT ownership. */
  confidence: number;
  suggestedEmployeeId?: string;
  /** Confidence that the employee is the correct owner. Separate threshold. */
  assignmentConfidence: number;
  /** Only when a deliberate generative classifier ran. */
  summary?: string;
  keyPoints: string[];
  suggestedNextAction?: string;
  automationType?: "newsletter" | "bounce" | "receipt" | "notification";
  safetyFlags: string[];
  source: "rules" | "embeddings" | "classifier";
};

export type EmailJobType = "triage" | "draft" | "rewrite" | "inbound_wake";

export type EmailJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const ASSISTANCE_MODE_LABELS = {
  manual: {
    label: "Off",
    helper: "AdeHQ will not analyse or route new email.",
  },
  ai_triage: {
    label: "Organise inbox",
    helper:
      "AI helps classify, prioritise, and suggest ownership. No replies are generated automatically.",
  },
  ai_triage_suggested_replies: {
    label: "Organise and suggest actions",
    helper:
      "AI also recommends next steps and offers one-click drafting. Email bodies are still only drafted when requested.",
  },
} as const;

export const LEASE_MINUTES = 5;
