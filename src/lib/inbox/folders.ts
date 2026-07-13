/**
 * Query-based folders (Slice B). The legacy `folder` column is no longer the
 * source of truth — folders are derived from operational thread state.
 */

import type { InboxFolder } from "./types";

type ThreadQuery = {
  eq: (col: string, value: unknown) => ThreadQuery;
  in: (col: string, values: unknown[]) => ThreadQuery;
  neq: (col: string, value: unknown) => ThreadQuery;
};

/**
 * Apply the folder's predicate to a `email_threads` query. Drafts are served
 * from `email_drafts` and are handled separately by the drafts route.
 */
export function applyFolderFilter(query: ThreadQuery, folder: InboxFolder): ThreadQuery {
  switch (folder) {
    case "inbox":
      // Needs attention: latest external message is inbound.
      return query
        .eq("status", "open")
        .eq("is_spam", false)
        .eq("latest_direction", "inbound");
    case "awaiting":
      // We last wrote outbound; waiting on the other party.
      return query
        .in("status", ["open", "waiting"])
        .eq("is_spam", false)
        .eq("latest_direction", "outbound");
    case "sent":
      // Threads where we sent at least one message. List rows use the last
      // *outbound* message for peer/snippet (Gmail-style), not the latest inbound.
      return query
        .in("direction_state", ["outbound", "mixed"])
        .eq("is_spam", false)
        .neq("status", "archived");
    case "archived":
      return query.eq("status", "archived");
    case "spam":
      return query.eq("is_spam", true);
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
  if (folder === "sent") return "outbound";
  if (folder === "inbox" || folder === "awaiting") {
    return folder === "awaiting" ? "outbound" : "inbound";
  }
  return "any";
}
