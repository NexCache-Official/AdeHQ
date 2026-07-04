import type { SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@browserbasehq/stagehand";
import { persistBrowserEvidence } from "@/lib/drive/evidence-store";
import { isBrowserResearchEvidenceEnabled } from "./provider-config";

export type CaptureBrowserResearchEvidenceParams = {
  client: SupabaseClient;
  workspaceId: string;
  roomId?: string;
  topicId?: string;
  runId: string;
  page: Page;
  sourceUrl: string;
  sourceTitle: string;
  createdByUserId?: string;
};

/**
 * Capture one page screenshot into browser_evidence. Never throws — failures are logged and ignored.
 * Must be called inside the live Browserbase session (same page, before close).
 */
export async function captureBrowserResearchPageEvidenceSafely(
  params: CaptureBrowserResearchEvidenceParams,
): Promise<string | null> {
  if (!isBrowserResearchEvidenceEnabled()) return null;

  try {
    const screenshot = await params.page.screenshot({ type: "png", timeout: 15_000 });
    const evidence = await persistBrowserEvidence({
      client: params.client,
      workspaceId: params.workspaceId,
      roomId: params.roomId ?? null,
      topicId: params.topicId ?? null,
      runId: params.runId,
      title: params.sourceTitle.slice(0, 120) || "Research screenshot",
      sourceUrl: params.sourceUrl,
      screenshot,
      createdByUserId: params.createdByUserId ?? null,
      metadata: {
        browserResearchRunId: params.runId,
        capturePhase: "live_browse",
      },
    });
    return evidence.id;
  } catch (error) {
    console.warn("[AdeHQ browser research evidence]", {
      runId: params.runId,
      sourceUrl: params.sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
