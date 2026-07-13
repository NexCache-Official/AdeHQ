/**
 * Inbound webhook ingest — verify already done by route.
 * Stores event + enqueues processing; never runs AI here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundWebhookMeta } from "@/lib/inbox/provider/types";

export type StoreInboundResult = {
  eventId: string;
  duplicate: boolean;
  processingState: string;
};

export async function storeInboundWebhookEvent(
  client: SupabaseClient,
  params: {
    meta: InboundWebhookMeta;
    svixId: string | null;
  },
): Promise<StoreInboundResult> {
  if (params.svixId) {
    const existing = await client
      .from("email_inbound_events")
      .select("id, processing_state")
      .eq("svix_id", params.svixId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      return {
        eventId: String(existing.data.id),
        duplicate: true,
        processingState: String(existing.data.processing_state),
      };
    }
  }

  if (params.meta.providerEmailId && params.meta.eventType === "email.received") {
    const existing = await client
      .from("email_inbound_events")
      .select("id, processing_state")
      .eq("provider_email_id", params.meta.providerEmailId)
      .eq("event_type", "email.received")
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      return {
        eventId: String(existing.data.id),
        duplicate: true,
        processingState: String(existing.data.processing_state),
      };
    }
  }

  const { data, error } = await client
    .from("email_inbound_events")
    .insert({
      svix_id: params.svixId,
      provider_email_id: params.meta.providerEmailId,
      event_type: params.meta.eventType,
      // Always queue — webhook returns 200; cron/nudge drains (including delivery events).
      processing_state: "queued",
      raw_payload: params.meta.rawPayload as object,
    })
    .select("id, processing_state")
    .single();

  if (error) {
    // Unique race → treat as duplicate
    if (error.code === "23505" && params.svixId) {
      const again = await client
        .from("email_inbound_events")
        .select("id, processing_state")
        .eq("svix_id", params.svixId)
        .maybeSingle();
      if (again.data) {
        return {
          eventId: String(again.data.id),
          duplicate: true,
          processingState: String(again.data.processing_state),
        };
      }
    }
    throw error;
  }

  return {
    eventId: String(data.id),
    duplicate: false,
    processingState: String(data.processing_state),
  };
}
