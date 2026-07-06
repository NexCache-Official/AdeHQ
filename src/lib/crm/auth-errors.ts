/** Map raw API auth errors to user-friendly CRM copy. */
export function formatCrmClientError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("missing authorization token") || lower.includes("not signed in")) {
    return "Session expired — refresh the page or sign in again.";
  }
  if (lower.includes("forbidden") || lower.includes("not a member")) {
    return "You do not have access to this workspace's CRM.";
  }
  return message;
}
