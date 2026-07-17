import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenIncidentCount } from "./incidents";
import { getModelsSummary } from "./models";
import { getJobsSummary } from "./jobs";
import {
  getBuildInformation,
  REQUIRED_MIGRATION_VERSION,
  type BuildInformation,
} from "@/lib/release/build-information";

export type SystemHealthSummary = {
  openIncidents: number;
  providerHealth: Awaited<ReturnType<typeof getModelsSummary>>["providerHealth"];
  jobs: Awaited<ReturnType<typeof getJobsSummary>>;
  databaseOk: boolean;
  buildInfo: BuildInformation;
};

export async function getSystemHealthSummary(
  client: SupabaseClient,
): Promise<SystemHealthSummary> {
  const [openIncidents, models, jobs] = await Promise.all([
    getOpenIncidentCount(client),
    getModelsSummary(client),
    getJobsSummary(client),
  ]);

  let databaseOk = true;
  let migrationVersion = REQUIRED_MIGRATION_VERSION;
  try {
    const { error } = await client.from("profiles").select("id", { head: true, count: "exact" });
    if (error) databaseOk = false;
    const reliability = await client.from("brain_runs").select("lifecycle_status").limit(1);
    if (reliability.error) {
      const avatars = await client.from("profiles").select("avatar_source").limit(1);
      migrationVersion = avatars.error ? "unknown" : "20260717140000";
    }
  } catch {
    databaseOk = false;
    migrationVersion = "unknown";
  }

  return {
    openIncidents,
    providerHealth: models.providerHealth,
    jobs,
    databaseOk,
    buildInfo: getBuildInformation({ migrationVersion }),
  };
}
