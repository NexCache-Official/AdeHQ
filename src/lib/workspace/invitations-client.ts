import { authHeaders } from "@/lib/api/auth-client";

export type InvitePreview = {
  workspaceId: string;
  workspaceName: string;
  role: "admin" | "member";
  invitedEmail: string;
  status: string;
  expired: boolean;
};

export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Invitation not found.");
  return body as InvitePreview;
}

export async function acceptInvitationByToken(
  token: string,
): Promise<{ workspaceId: string; workspaceName: string }> {
  const headers = await authHeaders();
  const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Unable to accept invitation.");
  return {
    workspaceId: String(body.workspaceId),
    workspaceName: String(body.workspaceName ?? "workspace"),
  };
}

export async function declineInvitationByToken(token: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/decline`, {
    method: "POST",
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Unable to decline invitation.");
}
