import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhLedgerEntryType } from "./types";

export async function appendLedgerEntry(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    entryType: WhLedgerEntryType;
    amountWh: number;
    balanceAfter?: number | null;
    usagePeriodId?: string | null;
    brainRunId?: string | null;
    promotionId?: string | null;
    purchaseId?: string | null;
    lotId?: string | null;
    reservationId?: string | null;
    idempotencyKey: string;
    createdBy?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string; duplicate: boolean }> {
  const { data, error } = await client
    .from("wh_ledger_entries")
    .upsert(
      {
        workspace_id: input.workspaceId,
        entry_type: input.entryType,
        amount_wh: input.amountWh,
        balance_after: input.balanceAfter ?? null,
        usage_period_id: input.usagePeriodId ?? null,
        brain_run_id: input.brainRunId ?? null,
        promotion_id: input.promotionId ?? null,
        purchase_id: input.purchaseId ?? null,
        lot_id: input.lotId ?? null,
        reservation_id: input.reservationId ?? null,
        idempotency_key: input.idempotencyKey,
        created_by: input.createdBy ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata ?? {},
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const existing = await client
      .from("wh_ledger_entries")
      .select("id")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing.error) throw existing.error;
    return { id: String(existing.data?.id), duplicate: true };
  }
  return { id: String(data.id), duplicate: false };
}

/** Sum of active reserved WH for a workspace. */
export async function sumActiveReservations(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("wh_reservations")
    .select("reserved_wh, settled_wh, status")
    .eq("workspace_id", workspaceId)
    .in("status", ["reserved", "partially_settled"])
    .gt("expires_at", now);
  if (error) throw error;
  let total = 0;
  for (const row of data ?? []) {
    const reserved = Number(row.reserved_wh ?? 0);
    const settled = Number(row.settled_wh ?? 0);
    total += Math.max(0, reserved - settled);
  }
  return total;
}

/** Remaining WH across non-expired credit lots. */
export async function sumCreditLotRemaining(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("wh_credit_lots")
    .select("remaining_wh, expires_at")
    .eq("workspace_id", workspaceId)
    .gt("remaining_wh", 0);
  if (error) throw error;
  let total = 0;
  for (const row of data ?? []) {
    if (row.expires_at && String(row.expires_at) <= now) continue;
    total += Number(row.remaining_wh ?? 0);
  }
  return total;
}
