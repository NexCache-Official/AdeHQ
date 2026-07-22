import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

function configure() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    `mailto:${process.env.SUPPORT_EMAIL?.trim() || "support@adehq.com"}`;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

async function sendPushToUser(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    payload: Record<string, unknown>;
    options: webpush.RequestOptions;
  },
) {
  if (!configure()) return { sent: 0, configured: false };
  const { data, error } = await service
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .eq("enabled", true);
  if (error) throw error;
  let sent = 0;
  await Promise.all(
    (data ?? []).map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(subscription.endpoint),
            keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth) },
          },
          JSON.stringify(params.payload),
          params.options,
        );
        sent += 1;
        await service
          .from("push_subscriptions")
          .update({
            last_success_at: new Date().toISOString(),
            last_failure_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", params.workspaceId)
          .eq("id", subscription.id);
      } catch (pushError) {
        const statusCode = (pushError as { statusCode?: number }).statusCode;
        await service
          .from("push_subscriptions")
          .update({
            last_failure_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...(statusCode === 404 || statusCode === 410 ? { enabled: false } : {}),
          })
          .eq("workspace_id", params.workspaceId)
          .eq("id", subscription.id);
      }
    }),
  );
  return { sent, configured: true };
}

export async function sendIncomingCallPush(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    callId: string;
    invitationId: string;
    title: string;
  },
) {
  return sendPushToUser(service, {
    workspaceId: params.workspaceId,
    userId: params.userId,
    payload: {
      type: "incoming_call",
      callId: params.callId,
      invitationId: params.invitationId,
      title: params.title,
      url: `/calls?call=${encodeURIComponent(params.callId)}`,
    },
    options: { TTL: 45, urgency: "high", topic: `call-${params.callId}` },
  });
}

export async function sendTestCallPush(
  service: SupabaseClient,
  params: { workspaceId: string; userId: string },
) {
  return sendPushToUser(service, {
    ...params,
    payload: {
      type: "call_notification_test",
      title: "AdeHQ call notifications are ready",
      url: "/calls",
    },
    options: { TTL: 60, urgency: "normal", topic: "call-notification-test" },
  });
}
