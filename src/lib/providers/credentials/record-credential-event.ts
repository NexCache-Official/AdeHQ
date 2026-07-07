import type { SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "@/lib/utils";
import type { ManagedProviderId } from "./types";

export type ProviderCredentialEventType =
  | "created"
  | "assigned"
  | "used"
  | "rotated"
  | "revoked"
  | "disabled"
  | "failed"
  | "fallback_used"
  | "tested"
  | "updated"
  | "budget_exceeded"
  | "health_skipped";

export async function recordCredentialEvent(
  client: SupabaseClient,
  input: {
    credentialId?: string | null;
    workspaceId?: string | null;
    provider: ManagedProviderId | string;
    eventType: ProviderCredentialEventType;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    createdBy?: string | null;
  },
): Promise<void> {
  const now = nowISO();
  const { error } = await client.from("platform_provider_credential_events").insert({
    credential_id: input.credentialId ?? null,
    workspace_id: input.workspaceId ?? null,
    provider: input.provider,
    event_type: input.eventType,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
    created_by: input.createdBy ?? null,
    created_at: now,
  });
  if (error) {
    console.warn("[AdeHQ provider credentials] event write failed", error);
  }

  if (input.credentialId) {
    const patch: Record<string, unknown> = { last_used_at: now };
    if (input.eventType === "used" || input.eventType === "tested") {
      patch.last_success_at = now;
      if (input.eventType === "tested") patch.last_tested_at = now;
    }
    if (input.eventType === "failed") patch.last_failure_at = now;
    await client
      .from("platform_provider_credentials")
      .update(patch)
      .eq("id", input.credentialId)
      .then(({ error: updateError }) => {
        if (updateError) console.warn("[AdeHQ provider credentials] timestamp update failed", updateError);
      });
  }
}
