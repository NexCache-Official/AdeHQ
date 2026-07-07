import type { BrowserResearchProvider } from "./types";
import { isBrowserResearchLiveReady } from "./provider-config";
import { getPublicAppUrl } from "@/lib/site-url";

export function shouldRunBrowserResearchAsync(provider: BrowserResearchProvider): boolean {
  return provider === "browserbase" && isBrowserResearchLiveReady();
}

export function getInternalAppBaseUrl(): string {
  return getPublicAppUrl();
}

export function getBrowserResearchExecuteSecret(): string | undefined {
  return (
    process.env.BROWSER_RESEARCH_EXECUTE_SECRET?.trim() ||
    process.env.INTERNAL_CRON_SECRET?.trim() ||
    undefined
  );
}

/** Fire-and-forget execution on a dedicated route (required for live Browserbase sessions). */
export function scheduleBrowserResearchRunExecution(params: {
  runId: string;
  workspaceId: string;
  agentRunId?: string;
  baseUrl?: string;
}): void {
  const baseUrl = (params.baseUrl ?? getInternalAppBaseUrl()).replace(/\/$/, "");
  const secret = getBrowserResearchExecuteSecret();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["x-adehq-research-execute-secret"] = secret;

  void fetch(`${baseUrl}/api/browser-research/runs/${params.runId}/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      agentRunId: params.agentRunId,
    }),
  }).catch((error) => {
    console.error("[AdeHQ browser research] failed to schedule execute", {
      runId: params.runId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
