import { getVercelConfig, vercelApiFetch } from "./client";

export type RedeployResult = {
  triggered: boolean;
  deploymentId?: string;
  url?: string;
  status?: string;
  detail: string;
};

/**
 * Redeploy the latest production deployment via the Vercel REST API.
 * A redeploy re-runs the build and picks up the project's current env vars,
 * so newly-written secrets become active once it reaches READY.
 */
export async function redeployLatestProduction(
  meta?: Record<string, string>,
): Promise<RedeployResult> {
  const config = getVercelConfig();
  if (!config) {
    return { triggered: false, detail: "Vercel API is not configured on this deployment." };
  }

  // Resolve the opaque project id from the configured id-or-name.
  const project = await vercelApiFetch<{ id: string; name: string }>(
    config,
    `/v9/projects/${encodeURIComponent(config.projectIdOrName)}`,
  );

  const list = await vercelApiFetch<{
    deployments?: Array<{ uid: string; url?: string; state?: string }>;
  }>(config, `/v6/deployments?projectId=${encodeURIComponent(project.id)}&target=production&limit=1`);

  const latest = list.deployments?.[0];
  if (!latest?.uid) {
    return {
      triggered: false,
      detail: "No existing production deployment to redeploy — trigger a deploy from Git first.",
    };
  }

  const created = await vercelApiFetch<{
    id?: string;
    url?: string;
    readyState?: string;
    status?: string;
  }>(config, `/v13/deployments?forceNew=1`, {
    method: "POST",
    body: JSON.stringify({
      name: project.name,
      deploymentId: latest.uid,
      target: "production",
      ...(meta ? { meta } : {}),
    }),
  });

  const url = created.url ? `https://${created.url}` : undefined;
  return {
    triggered: true,
    deploymentId: created.id,
    url,
    status: created.readyState ?? created.status,
    detail: url ? `Redeploy started (${url}).` : "Production redeploy started.",
  };
}
