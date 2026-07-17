import type { SupabaseClient } from "@supabase/supabase-js";
import { appendLedgerEntry, sumActiveReservations, sumCreditLotRemaining } from "./ledger";

export type ReserveWhResult =
  | { ok: true; reservationId: string; reservedWh: number }
  | { ok: false; reason: "insufficient_wh" | "duplicate"; availableWh?: number; reservationId?: string };

/**
 * Atomically reserve WH against projected available balance.
 * Available = period remaining + lots − active reservations.
 */
export async function reserveWorkHours(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    brainRunId: string;
    estimatedWh: number;
    periodRemainingWh: number;
    idempotencyKey: string;
    expiresAt: Date;
    unlimited?: boolean;
  },
): Promise<ReserveWhResult> {
  const estimated = Math.max(0, Number(input.estimatedWh) || 0);

  const existing = await client
    .from("wh_reservations")
    .select("id, reserved_wh, status")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing.data) {
    return {
      ok: true,
      reservationId: String(existing.data.id),
      reservedWh: Number(existing.data.reserved_wh),
    };
  }

  if (!input.unlimited) {
    const [reserved, lots] = await Promise.all([
      sumActiveReservations(client, input.workspaceId),
      sumCreditLotRemaining(client, input.workspaceId),
    ]);
    const available = Math.max(0, input.periodRemainingWh) + lots - reserved;
    if (estimated > available + 1e-9) {
      return { ok: false, reason: "insufficient_wh", availableWh: available };
    }
  }

  const { data, error } = await client
    .from("wh_reservations")
    .insert({
      workspace_id: input.workspaceId,
      brain_run_id: input.brainRunId,
      estimated_wh: estimated,
      reserved_wh: estimated,
      status: "reserved",
      idempotency_key: input.idempotencyKey,
      expires_at: input.expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (String(error.message ?? "").includes("duplicate") || error.code === "23505") {
      const again = await client
        .from("wh_reservations")
        .select("id, reserved_wh")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (again.data) {
        return {
          ok: true,
          reservationId: String(again.data.id),
          reservedWh: Number(again.data.reserved_wh),
        };
      }
    }
    throw error;
  }

  await appendLedgerEntry(client, {
    workspaceId: input.workspaceId,
    entryType: "reservation_hold",
    amountWh: -estimated,
    reservationId: String(data.id),
    brainRunId: input.brainRunId,
    idempotencyKey: `reservation-hold:${input.idempotencyKey}`,
  });

  return { ok: true, reservationId: String(data.id), reservedWh: estimated };
}

export async function settleReservation(
  client: SupabaseClient,
  input: {
    reservationId: string;
    workspaceId: string;
    settledWh: number;
    usagePeriodId?: string | null;
  },
): Promise<void> {
  const { data: reservation, error } = await client
    .from("wh_reservations")
    .select("*")
    .eq("id", input.reservationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!reservation) throw new Error("Reservation not found.");

  const reserved = Number(reservation.reserved_wh);
  const settled = Math.min(Math.max(0, input.settledWh), reserved);
  const released = Math.max(0, reserved - settled);
  const status =
    settled <= 0 ? "released" : settled < reserved ? "partially_settled" : "settled";

  const { error: updateError } = await client
    .from("wh_reservations")
    .update({
      settled_wh: settled,
      status: status === "partially_settled" && released === 0 ? "settled" : status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.reservationId);
  if (updateError) throw updateError;

  if (settled > 0) {
    await appendLedgerEntry(client, {
      workspaceId: input.workspaceId,
      entryType: "usage_debit",
      amountWh: -settled,
      usagePeriodId: input.usagePeriodId,
      reservationId: input.reservationId,
      brainRunId: String(reservation.brain_run_id),
      idempotencyKey: `reservation-settle:${input.reservationId}`,
    });
  }

  if (released > 0) {
    await appendLedgerEntry(client, {
      workspaceId: input.workspaceId,
      entryType: "reservation_release",
      amountWh: released,
      reservationId: input.reservationId,
      brainRunId: String(reservation.brain_run_id),
      idempotencyKey: `reservation-release:${input.reservationId}`,
    });
  }

  if (settled > 0 && released === 0) {
    await client
      .from("wh_reservations")
      .update({ status: "settled", updated_at: new Date().toISOString() })
      .eq("id", input.reservationId);
  } else if (settled === 0) {
    await client
      .from("wh_reservations")
      .update({ status: "released", updated_at: new Date().toISOString() })
      .eq("id", input.reservationId);
  }
}
