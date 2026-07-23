import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspacePlan } from "@/lib/billing/plans/resolve-workspace-plan";
import { applyCostToPeriod } from "@/lib/billing/usage/periods";
import {
  getWorkHourUsdRate,
  workHoursFromCost,
} from "@/lib/billing/costing/work-hours";

export const STANDARD_TTS_INTERNAL_USD_PER_CALL = 0.02;

export type VoiceTreatment =
  | "internal_only"
  | "platform_absorbed"
  | "customer_charged";

export type VoiceCapability =
  | "live_call_minutes"
  | "speech_to_text"
  | "standard_tts"
  | "premium_tts";

export type VoicePlanEntitlements = {
  monthlyLiveCallMinutes: number | null;
  standardTtsInternalUsdPerCall: number;
  standardTtsCustomerWhPerCall: number;
  standardTtsTreatment: VoiceTreatment;
  premiumTtsTreatment: VoiceTreatment;
  sttTreatment: VoiceTreatment;
  transcriptIncluded: boolean;
  captionsIncluded: boolean;
};

export type LiveCallUsageReceipt = {
  periodId: string;
  planSlug: string;
  periodStart: string;
  periodEnd: string;
  allowanceMinutes: number | null;
  usedMinutes: number;
  remainingMinutes: number | null;
  callCount: number;
  burnApplied?: boolean;
};

export type LiveCallUsageCheck = LiveCallUsageReceipt & {
  allowed: boolean;
};

const LAUNCH_MONTHLY_MINUTES: Record<string, number | null> = {
  free: 0,
  pro: 120,
  team: 500,
  business: 2_000,
  enterprise: null,
};

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function treatmentOr(value: unknown, fallback: VoiceTreatment): VoiceTreatment {
  return value === "internal_only" ||
    value === "platform_absorbed" ||
    value === "customer_charged"
    ? value
    : fallback;
}

export function resolveVoicePlanEntitlements(
  planSlug: string,
  entitlements: Record<string, unknown> | null | undefined,
): VoicePlanEntitlements {
  const voice =
    entitlements?.voice && typeof entitlements.voice === "object"
      ? (entitlements.voice as Record<string, unknown>)
      : {};
  const rawAllowance = voice.monthly_live_call_minutes;
  const fallbackAllowance =
    planSlug in LAUNCH_MONTHLY_MINUTES
      ? LAUNCH_MONTHLY_MINUTES[planSlug]
      : 0;
  const monthlyLiveCallMinutes =
    rawAllowance === null
      ? null
      : rawAllowance === undefined
        ? fallbackAllowance
        : numberOr(rawAllowance, fallbackAllowance ?? 0);

  return {
    monthlyLiveCallMinutes,
    standardTtsInternalUsdPerCall: numberOr(
      voice.standard_tts_internal_usd_per_call,
      STANDARD_TTS_INTERNAL_USD_PER_CALL,
    ),
    standardTtsCustomerWhPerCall: numberOr(
      voice.standard_tts_customer_wh_per_call,
      0,
    ),
    standardTtsTreatment: treatmentOr(
      voice.standard_tts_treatment,
      "platform_absorbed",
    ),
    premiumTtsTreatment: treatmentOr(
      voice.premium_tts_treatment,
      "customer_charged",
    ),
    sttTreatment: treatmentOr(voice.stt_treatment, "platform_absorbed"),
    transcriptIncluded: voice.transcript_included !== false,
    captionsIncluded: voice.captions_included !== false,
  };
}

export function calendarMonthPeriod(at = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const periodStart = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1),
  );
  const periodEnd = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1),
  );
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

export function billableCallMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.round((durationSeconds / 60) * 10_000) / 10_000;
}

export function standardTtsCostSplit(
  internalCostUsd: number,
  includedUsdPerCall: number,
): { platformAbsorbedUsd: number; customerChargedUsd: number } {
  const internal = Math.max(0, Number(internalCostUsd) || 0);
  const allowance = Math.max(0, Number(includedUsdPerCall) || 0);
  const platformAbsorbedUsd = Math.min(internal, allowance);
  return {
    platformAbsorbedUsd,
    customerChargedUsd:
      Math.round(Math.max(0, internal - platformAbsorbedUsd) * 100_000_000) /
      100_000_000,
  };
}

function receiptFromRow(row: Record<string, unknown>): LiveCallUsageReceipt {
  const allowance =
    row.allowance_minutes == null ? null : Number(row.allowance_minutes);
  const used = Number(row.used_minutes ?? 0);
  return {
    periodId: String(row.id),
    planSlug: String(row.plan_slug),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    allowanceMinutes: allowance,
    usedMinutes: used,
    remainingMinutes: allowance == null ? null : Math.max(allowance - used, 0),
    callCount: Number(row.call_count ?? 0),
  };
}

export async function resolveMonthlyLiveCallUsage(
  client: SupabaseClient,
  workspaceId: string,
  at = new Date(),
): Promise<LiveCallUsageReceipt & { entitlements: VoicePlanEntitlements }> {
  const plan = await resolveWorkspacePlan(client, workspaceId);
  const voice = resolveVoicePlanEntitlements(
    plan.planSlug,
    plan.config.entitlements,
  );
  const { periodStart, periodEnd } = calendarMonthPeriod(at);
  const snapshot = {
    voice,
    planSource: plan.source,
  };
  const { data, error } = await client
    .from("live_call_usage_periods")
    .upsert(
      {
        workspace_id: workspaceId,
        plan_slug: plan.planSlug,
        period_start: periodStart,
        period_end: periodEnd,
        allowance_minutes: voice.monthlyLiveCallMinutes,
        entitlement_snapshot: snapshot,
      },
      { onConflict: "workspace_id,period_start,period_end" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return { ...receiptFromRow(data as Record<string, unknown>), entitlements: voice };
}

export async function checkMonthlyLiveCallMinutes(
  client: SupabaseClient,
  workspaceId: string,
  at = new Date(),
): Promise<LiveCallUsageCheck & { entitlements: VoicePlanEntitlements }> {
  const usage = await resolveMonthlyLiveCallUsage(client, workspaceId, at);
  return {
    ...usage,
    allowed:
      usage.allowanceMinutes === null ||
      usage.usedMinutes < usage.allowanceMinutes,
  };
}

export async function burnMonthlyLiveCallMinutes(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    callId: string;
    callSource: "brain_live" | "human_live";
    startedAt: string | null;
    endedAt?: string | null;
    idempotencyKey?: string;
  },
): Promise<LiveCallUsageReceipt & { durationSeconds: number; minutes: number }> {
  const ended = input.endedAt ? new Date(input.endedAt) : new Date();
  const startedMs = input.startedAt ? Date.parse(input.startedAt) : ended.getTime();
  const durationSeconds = Math.max(
    0,
    Math.round((ended.getTime() - (Number.isFinite(startedMs) ? startedMs : ended.getTime())) / 1_000),
  );
  const minutes = billableCallMinutes(durationSeconds);
  const plan = await resolveWorkspacePlan(client, input.workspaceId);
  const voice = resolveVoicePlanEntitlements(plan.planSlug, plan.config.entitlements);
  const { periodStart, periodEnd } = calendarMonthPeriod(ended);
  const { data, error } = await client.rpc("burn_live_call_minutes", {
    p_workspace_id: input.workspaceId,
    p_plan_slug: plan.planSlug,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_allowance_minutes: voice.monthlyLiveCallMinutes,
    p_minutes: minutes,
    p_call_id: input.callId,
    p_call_source: input.callSource,
    p_duration_seconds: durationSeconds,
    p_idempotency_key:
      input.idempotencyKey ?? `voice:call-minutes:${input.callSource}:${input.callId}`,
    p_entitlement_snapshot: { voice, planSource: plan.source },
  });
  if (error) throw error;
  const receipt = data as LiveCallUsageReceipt;
  return {
    ...receipt,
    allowanceMinutes:
      receipt.allowanceMinutes == null ? null : Number(receipt.allowanceMinutes),
    usedMinutes: Number(receipt.usedMinutes ?? 0),
    remainingMinutes:
      receipt.remainingMinutes == null ? null : Number(receipt.remainingMinutes),
    callCount: Number(receipt.callCount ?? 0),
    durationSeconds,
    minutes,
  };
}

export async function recordVoiceEconomics(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    callId: string;
    callSource: "brain_live" | "human_live";
    capability: Exclude<VoiceCapability, "live_call_minutes">;
    treatment: VoiceTreatment;
    quantity: number;
    unit: "seconds" | "calls" | "characters";
    internalCostUsd: number;
    platformAbsorbedUsd?: number;
    customerChargedUsd?: number;
    customerChargedWh?: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const plan = await resolveWorkspacePlan(client, input.workspaceId);
  const customerChargedUsd =
    input.treatment === "customer_charged"
      ? Math.max(0, input.customerChargedUsd ?? input.internalCostUsd)
      : 0;
  const platformAbsorbedUsd = Math.max(
    0,
    input.platformAbsorbedUsd ??
      (input.treatment === "platform_absorbed" ? input.internalCostUsd : 0),
  );
  const { error } = await client.from("voice_usage_ledger").insert({
    workspace_id: input.workspaceId,
    call_id: input.callId,
    call_source: input.callSource,
    plan_slug: plan.planSlug,
    capability: input.capability,
    treatment: input.treatment,
    quantity: Math.max(0, input.quantity),
    unit: input.unit,
    internal_cost_usd: Math.max(0, input.internalCostUsd),
    platform_absorbed_usd: platformAbsorbedUsd,
    customer_charged_usd: customerChargedUsd,
    customer_charged_wh: Math.max(0, input.customerChargedWh ?? 0),
    idempotency_key: input.idempotencyKey,
    metadata: input.metadata ?? {},
  });
  if (error?.code === "23505") return false;
  if (error) throw error;
  return true;
}

export type SettledCallReceipt = {
  durationSeconds: number;
  liveCallMinutes: number;
  aiWorkHours: number;
  transcriptIncluded: boolean;
  captionsIncluded: boolean;
  monthlyUsage: LiveCallUsageReceipt;
};

export async function settleBrainLiveCall(
  client: SupabaseClient,
  input: { workspaceId: string; callId: string; endedAt?: string },
): Promise<SettledCallReceipt> {
  const { data: call, error } = await client
    .from("calls")
    .select(
      "started_at, ended_at, settled_wh, voice_route_policy, duration_seconds, live_call_minutes",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.callId)
    .maybeSingle();
  if (error) throw error;
  if (!call) throw new Error("Call not found for voice settlement.");

  const endedAt = input.endedAt ?? String(call.ended_at ?? new Date().toISOString());
  const monthlyUsage = await burnMonthlyLiveCallMinutes(client, {
    workspaceId: input.workspaceId,
    callId: input.callId,
    callSource: "brain_live",
    startedAt: call.started_at ? String(call.started_at) : null,
    endedAt,
  });
  const { data: settlements, error: settlementsError } = await client
    .from("call_usage_settlements")
    .select("component, customer_charged_wh")
    .eq("workspace_id", input.workspaceId)
    .eq("call_id", input.callId);
  if (settlementsError) throw settlementsError;
  const plan = await resolveWorkspacePlan(client, input.workspaceId);
  const voice = resolveVoicePlanEntitlements(plan.planSlug, plan.config.entitlements);
  const { data: costRows, error: costRowsError } = await client
    .from("ai_cost_ledger_entries")
    .select("work_type, actual_cost_usd, estimated_cost_usd, work_hours_charged")
    .eq("workspace_id", input.workspaceId)
    .contains("metadata", { callId: input.callId });
  if (costRowsError) throw costRowsError;
  const sttInternalCostUsd = (costRows ?? [])
    .filter((row) => row.work_type === "call_stt")
    .reduce(
      (total, row) =>
        total + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0),
      0,
    );
  if (sttInternalCostUsd > 0) {
    await recordVoiceEconomics(client, {
      workspaceId: input.workspaceId,
      callId: input.callId,
      callSource: "brain_live",
      capability: "speech_to_text",
      treatment: voice.sttTreatment,
      quantity: 1,
      unit: "calls",
      internalCostUsd: sttInternalCostUsd,
      customerChargedWh: 0,
      idempotencyKey: `voice:stt-total:${input.callId}`,
      metadata: { providerNeutral: true, customerWhIncluded: true },
    });
  }
  let standardTtsExcessWh = 0;
  if (String(call.voice_route_policy ?? "standard") === "standard") {
    const standardTtsInternalCostUsd = (costRows ?? [])
      .filter(
        (row) =>
          row.work_type === "call_tts" || row.work_type === "call_tts_bridge",
      )
      .reduce(
        (total, row) =>
          total + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0),
        0,
      );
    const {
      platformAbsorbedUsd: includedUsd,
      customerChargedUsd: excessUsd,
    } = standardTtsCostSplit(
      standardTtsInternalCostUsd,
      voice.standardTtsInternalUsdPerCall,
    );
    standardTtsExcessWh = workHoursFromCost(
      excessUsd,
      getWorkHourUsdRate(),
    );
    const inserted = await recordVoiceEconomics(client, {
      workspaceId: input.workspaceId,
      callId: input.callId,
      callSource: "brain_live",
      capability: "standard_tts",
      treatment:
        excessUsd > 0 ? "customer_charged" : voice.standardTtsTreatment,
      quantity: 1,
      unit: "calls",
      internalCostUsd: standardTtsInternalCostUsd,
      platformAbsorbedUsd: includedUsd,
      customerChargedUsd: excessUsd,
      customerChargedWh: standardTtsExcessWh,
      idempotencyKey: `voice:standard-tts-total:${input.callId}`,
      metadata: {
        providerNeutral: true,
        pricingBasis: "actual_call_usage",
        includedUsd,
        excessUsd,
      },
    });
    if (inserted && standardTtsExcessWh > 0) {
      await applyCostToPeriod(
        client,
        input.workspaceId,
        standardTtsExcessWh,
        excessUsd,
      );
    }
  }
  if (String(call.voice_route_policy ?? "standard") === "premium") {
    const premiumRows = (costRows ?? []).filter(
      (row) => row.work_type === "call_tts",
    );
    const premiumInternalCostUsd = premiumRows.reduce(
      (total, row) =>
        total + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0),
      0,
    );
    const premiumCustomerWh = (settlements ?? [])
      .filter(
        (settlement) =>
          settlement.component === "tts" &&
          Number(settlement.customer_charged_wh ?? 0) > 0,
      )
      .reduce(
        (total, settlement) =>
          total + Number(settlement.customer_charged_wh ?? 0),
        0,
      );
    if (premiumInternalCostUsd > 0 || premiumCustomerWh > 0) {
      await recordVoiceEconomics(client, {
        workspaceId: input.workspaceId,
        callId: input.callId,
        callSource: "brain_live",
        capability: "premium_tts",
        treatment: voice.premiumTtsTreatment,
        quantity: 1,
        unit: "calls",
        internalCostUsd: premiumInternalCostUsd,
        customerChargedUsd: premiumInternalCostUsd,
        customerChargedWh: premiumCustomerWh,
        idempotencyKey: `voice:premium-tts-total:${input.callId}`,
        metadata: { providerNeutral: true, pricingBasis: "actual_call_usage" },
      });
    }
  }
  const aiWorkHours =
    Math.round(
      ((settlements ?? []).reduce(
        (total, settlement) =>
          total + Number(settlement.customer_charged_wh ?? 0),
        0,
      ) +
        standardTtsExcessWh) *
        1_000_000,
    ) / 1_000_000;
  const { error: updateError } = await client
    .from("calls")
    .update({
      ended_at: endedAt,
      duration_seconds: monthlyUsage.durationSeconds,
      live_call_minutes: monthlyUsage.minutes,
      settled_wh: aiWorkHours,
      billing_settled_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.callId);
  if (updateError) throw updateError;
  return {
    durationSeconds: monthlyUsage.durationSeconds,
    liveCallMinutes: monthlyUsage.minutes,
    aiWorkHours,
    transcriptIncluded: voice.transcriptIncluded,
    captionsIncluded: voice.captionsIncluded,
    monthlyUsage,
  };
}

export async function settleHumanLiveCall(
  client: SupabaseClient,
  input: { workspaceId: string; callId: string; endedAt?: string },
): Promise<SettledCallReceipt> {
  const { data: call, error } = await client
    .from("call_sessions")
    .select(
      "started_at, ended_at, settled_ai_work_hours, duration_seconds, live_call_minutes",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.callId)
    .maybeSingle();
  if (error) throw error;
  if (!call) throw new Error("Call not found for voice settlement.");

  const endedAt = input.endedAt ?? String(call.ended_at ?? new Date().toISOString());
  const monthlyUsage = await burnMonthlyLiveCallMinutes(client, {
    workspaceId: input.workspaceId,
    callId: input.callId,
    callSource: "human_live",
    startedAt: call.started_at ? String(call.started_at) : null,
    endedAt,
  });
  const { data: aiTurns, error: aiTurnsError } = await client
    .from("call_ai_turns")
    .select("settled_wh")
    .eq("workspace_id", input.workspaceId)
    .eq("call_id", input.callId);
  if (aiTurnsError) throw aiTurnsError;
  const plan = await resolveWorkspacePlan(client, input.workspaceId);
  const voice = resolveVoicePlanEntitlements(plan.planSlug, plan.config.entitlements);
  const aiWorkHours = Math.round(
    (aiTurns ?? []).reduce(
      (total, turn) => total + Number(turn.settled_wh ?? 0),
      0,
    ) * 1_000_000,
  ) / 1_000_000;
  const { error: updateError } = await client
    .from("call_sessions")
    .update({
      ended_at: endedAt,
      duration_seconds: monthlyUsage.durationSeconds,
      live_call_minutes: monthlyUsage.minutes,
      settled_ai_work_hours: aiWorkHours,
      billing_settled_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.callId);
  if (updateError) throw updateError;
  return {
    durationSeconds: monthlyUsage.durationSeconds,
    liveCallMinutes: monthlyUsage.minutes,
    aiWorkHours,
    transcriptIncluded: voice.transcriptIncluded,
    captionsIncluded: voice.captionsIncluded,
    monthlyUsage,
  };
}
