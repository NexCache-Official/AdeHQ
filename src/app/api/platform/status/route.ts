import { NextResponse } from "next/server";
import { isPlatformFlagEnabled, getPlatformFlag } from "@/lib/admin/platform-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public read-only platform status for customer app (maintenance banner, signup gate). */
export async function GET() {
  try {
    const [maintenanceMode, signupsEnabled, maintenanceMessage] = await Promise.all([
      isPlatformFlagEnabled("maintenance_mode"),
      isPlatformFlagEnabled("signups_enabled"),
      getPlatformFlag<string>("maintenance_message"),
    ]);

    return NextResponse.json({
      maintenanceMode,
      signupsEnabled,
      maintenanceMessage:
        typeof maintenanceMessage === "string" ? maintenanceMessage : "",
    });
  } catch (error) {
    console.error("[AdeHQ platform status]", error);
    return NextResponse.json({
      maintenanceMode: false,
      signupsEnabled: true,
      maintenanceMessage: "",
    });
  }
}
