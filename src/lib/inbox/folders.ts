/**
 * Query-based folders (Slice B + C). Legacy `folder` column is not source of truth.
 */

import type { InboxFolder } from "./types";

type ThreadQuery = {
  eq: (col: string, value: unknown) => ThreadQuery;
  in: (col: string, values: unknown[]) => ThreadQuery;
  neq: (col: string, value: unknown) => ThreadQuery;
  or: (filters: string) => ThreadQuery;
  not: (col: string, op: string, value: unknown) => ThreadQuery;
};

/**
 * Apply the folder's predicate to a `email_threads` query. Drafts are served
 * from `email_drafts`. Needs-approval may be refined in the route via approvals.
 */
export function applyFolderFilter(query: ThreadQuery, folder: InboxFolder): ThreadQuery {
  switch (folder) {
    case "inbox":
      return query.in("status", ["open", "waiting"]).eq("is_spam", false);
    case "awaiting":
      return query
        .in("status", ["open", "waiting"])
        .eq("is_spam", false)
        .eq("latest_direction", "outbound");
    case "sent":
      return query
        .in("direction_state", ["outbound", "mixed"])
        .eq("is_spam", false)
        .neq("status", "archived");
    case "archived":
      return query.eq("status", "archived");
    case "spam":
      return query.eq("is_spam", true);
    case "ai_working":
      // Active jobs only — not every AI-assigned thread.
      return query
        .eq("is_spam", false)
        .or(
          "triage_status.in.(queued,running),draft_status.in.(queued,running)",
        );
    case "needs_approval":
      // Threads with a draft awaiting hash-valid approval (route may refine).
      return query
        .eq("is_spam", false)
        .not("latest_draft_id", "is", null)
        .in("draft_status", ["ready", "idle"]);
    case "assigned_to_me":
      // Human assignee filter applied in the threads route with current user id.
      return query.eq("is_spam", false).neq("status", "archived");
    case "drafts":
      return query.eq("id", "00000000-0000-0000-0000-000000000000");
    default:
      return query;
  }
}

/** Which message drives the list-row preview for this folder. */
export function listPreviewDirection(
  folder: InboxFolder,
): "inbound" | "outbound" | "any" {
  if (folder === "sent" || folder === "awaiting") return "outbound";
  return "any";
}
