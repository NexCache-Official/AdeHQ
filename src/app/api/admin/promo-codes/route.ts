import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCOUNT_TYPES = [
  "percent_off",
  "amount_off",
  "free_trial_days",
  "free_months",
  "extra_work_hours",
  "plan_override",
];

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const { data, error } = await serviceClient
    .from("promo_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const ids = (data ?? []).map((c) => c.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: redemptions } = await serviceClient
      .from("promo_code_redemptions")
      .select("promo_code_id")
      .in("promo_code_id", ids);
    for (const r of redemptions ?? []) {
      counts.set(r.promo_code_id, (counts.get(r.promo_code_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    promoCodes: (data ?? []).map((c) => ({ ...c, redemptionCount: counts.get(c.id) ?? 0 })),
  });
});

export const POST = adminRoute(async (request, { admin, serviceClient }) => {
  assertPlatformAdminCanWrite(admin);

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const discountType = typeof body?.discountType === "string" ? body.discountType : "";
  if (!code || !DISCOUNT_TYPES.includes(discountType)) {
    return NextResponse.json(
      { error: "code and a valid discountType are required." },
      { status: 400 },
    );
  }

  const payload = {
    code,
    description: body?.description ?? null,
    active: body?.active ?? true,
    discount_type: discountType,
    percent_off: body?.percentOff ?? null,
    amount_off_cents: body?.amountOffCents ?? null,
    free_trial_days: body?.freeTrialDays ?? null,
    free_months: body?.freeMonths ?? null,
    extra_work_hours_per_week: body?.extraWorkHoursPerWeek ?? null,
    applies_to_plan: body?.appliesToPlan ?? null,
    duration_type: body?.durationType ?? "once",
    duration_months: body?.durationMonths ?? null,
    max_redemptions: body?.maxRedemptions ?? null,
    max_redemptions_per_user: body?.maxRedemptionsPerUser ?? 1,
    starts_at: body?.startsAt ?? null,
    expires_at: body?.expiresAt ?? null,
    created_by: admin.userId,
  };

  const { data, error } = await serviceClient
    .from("promo_codes")
    .insert(payload)
    .select("*")
    .single();
  if (error) {
    if (String((error as { code?: string }).code) === "23505") {
      return NextResponse.json({ error: "A promo code with that code already exists." }, { status: 409 });
    }
    throw error;
  }

  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: "promo_code_created",
    targetType: "promo_code",
    targetId: data.id,
    after: data,
    request,
  });

  return NextResponse.json({ ok: true, promoCode: data });
});
