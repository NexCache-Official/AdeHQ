import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenIncidentCount } from "./incidents";
import { getModelsSummary } from "./models";
import { getJobsSummary } from "./jobs";

export type SystemHealthSummary = {
  openIncidents: number;
  providerHealth: Awaited<ReturnType<typeof getModelsSummary>>["providerHealth"];
  jobs: Awaited<ReturnType<typeof getJobsSummary>>;
  databaseOk: boolean;
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
  try {
    const { error } = await client.from("profiles").select("id", { head: true, count: "exact" });
    if (error) databaseOk = false;
  } catch {
    databaseOk = false;
  }

  return {
    openIncidents,
    providerHealth: models.providerHealth,
    jobs,
    databaseOk,
  };
}
