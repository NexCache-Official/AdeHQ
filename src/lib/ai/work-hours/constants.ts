/** USD cost per one AI Work Minute (shadow metering only in V19.9.1a). */
export function getWorkMinuteUsdRate(): number {
  const fromWorkMinute = Number(process.env.AI_WORK_MINUTE_USD);
  if (Number.isFinite(fromWorkMinute) && fromWorkMinute > 0) {
    return fromWorkMinute;
  }

  const legacy = Number(process.env.STANDARD_COST_PER_WORK_MINUTE_USD);
  if (Number.isFinite(legacy) && legacy > 0) {
    return legacy;
  }

  return 0.01;
}

export function isWorkHoursShadowEnabled(): boolean {
  const raw = process.env.AI_WORK_HOURS_SHADOW_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return true;
}

export const WORK_HOURS_SHADOW_MODE = "shadow" as const;
