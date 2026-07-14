import type { NextRequest } from "next/server";
import { resolveInboxRoute, type InboxRouteContext } from "./route-helpers";
import type { WorkActionBase } from "./work-actions";

export async function resolveWorkActionBase(
  request: NextRequest,
  body: { workspaceId?: string; clientActionId?: string },
  threadId: string,
): Promise<WorkActionBase & { ctx: InboxRouteContext }> {
  const ctx = await resolveInboxRoute(request, body.workspaceId, "organize");
  const name =
    (ctx.user.user_metadata?.full_name as string | undefined) ||
    (ctx.user.user_metadata?.name as string | undefined) ||
    ctx.user.email?.split("@")[0] ||
    "Member";
  return {
    ctx,
    client: ctx.secret,
    workspaceId: ctx.workspaceId,
    mailboxId: ctx.mailbox.id,
    threadId,
    userId: ctx.user.id,
    userName: name,
    access: ctx.access,
    clientActionId: body.clientActionId ?? "",
  };
}
