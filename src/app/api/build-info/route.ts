import { NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getBuildInformation, REQUIRED_MIGRATION_VERSION } from "@/lib/release/build-information";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Probe applied schema without relying on PostgREST exposure of
 * supabase_migrations.schema_migrations (usually unavailable).
 */
async function probeMigrationVersion(): Promise<string> {
  try {
    const service = createSupabaseSecretClient();

    // PR-17.5 reliability foundation
    const reliability = await service.from("brain_runs").select("lifecycle_status").limit(1);
    if (!reliability.error) {
      const routeHealth = await service.from("brain_route_health").select("route_id").limit(1);
      if (!routeHealth.error) return REQUIRED_MIGRATION_VERSION;
      // Column present but route health table missing — still 17.5-ish
      return "20260717150000";
    }

    // Profile avatars (prior baseline)
    const avatars = await service.from("profiles").select("avatar_source").limit(1);
    if (!avatars.error) return "20260717140000";

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Production-readable release baseline.
 * No secrets — safe for ops dashboards and deploy gates.
 */
export async function GET() {
  const migrationVersion = await probeMigrationVersion();
  const info = getBuildInformation({ migrationVersion });

  if (migrationVersion !== "unknown" && migrationVersion < REQUIRED_MIGRATION_VERSION) {
    info.mismatches.push(
      `migrationVersion probed=${migrationVersion} required=${REQUIRED_MIGRATION_VERSION}`,
    );
  }

  const ok = info.mismatches.length === 0 && info.migrationVersion !== "unknown";

  return NextResponse.json(
    {
      ok,
      ...info,
      checks: {
        catalogMatchesManifest: Number(info.catalogVersion) === info.release.catalogVersion,
        featuresMatchManifest:
          info.mismatches.filter((m) => m.startsWith("feature ")).length === 0,
        migrationProbeOk: info.migrationVersion !== "unknown",
        migrationMeetsRequired:
          info.migrationVersion !== "unknown" &&
          info.migrationVersion >= REQUIRED_MIGRATION_VERSION,
      },
    },
    {
      status: ok ? 200 : 503,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
