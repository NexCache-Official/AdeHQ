/**
 * Query-based folders (Slice B). The legacy `folder` column is no longer the
 * source of truth — folders are derived from operational thread state.
 */

import type { InboxFolder } from "./types";

// Loose builder type — avoids a direct dependency on postgrest-js internals.
type ThreadQuery = {
  eq: (col: string, value: unknown) => ThreadQuery;
  in: (col: string, values: unknown[]) => ThreadQuery;
};

/**
 * Apply the folder's predicate to a `email_threads` query. Drafts are served
 * from `email_drafts` and are handled separately by the drafts route.
 */
export function applyFolderFilter(query: ThreadQuery, folder: InboxFolder): ThreadQuery {
  switch (folder) {
    case "inbox":
      // Needs a customer reply (latest inbound). Includes threads that were
      // awaiting reply and just got answered — those reopen to status=open.
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
      // Threads we have participated in outbound (includes mixed conversations).
      // Prefer Inbox for unread inbound replies; Sent remains a participation view.
      return query.in("direction_state", ["outbound", "mixed"]).eq("is_spam", false);
    case "archived":
      return query.eq("status", "archived");
    case "spam":
      return query.eq("is_spam", true);
    case "drafts":
      // Not a thread query — callers should route to the drafts source.
      return query.eq("id", "00000000-0000-0000-0000-000000000000");
    default:
      return query;
  }
}
