import type { MessageArtifact } from "@/lib/types";
import type { ToolCallResult } from "./types";

const TOOL_LABELS: Record<string, string> = {
  "crm.createContact": "CRM contact",
  "crm.createCompany": "CRM company",
  "crm.createDeal": "CRM deal",
  "crm.updateDealStage": "deal stage update",
  "email.createDraft": "email draft",
  "tasks.createTask": "follow-up task",
  "artifact.createSpreadsheet": "spreadsheet",
  "artifact.createPdfReport": "PDF report",
};

function humanToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.split(".").pop()?.replace(/([A-Z])/g, " $1") ?? tool;
}

/** Inline chat chips for non-success tool outcomes the user must see. */
export function toolOutcomeArtifact(result: ToolCallResult): MessageArtifact | null {
  if (result.status === "success" || result.status === "preview" || result.status === "approval_pending") {
    return null;
  }

  const label = humanToolLabel(result.tool);

  if (result.status === "queued") {
    return {
      type: "tool_result",
      id: result.jobId ?? result.toolRunId ?? result.tool,
      label: `Generating ${label}…`,
      meta: {
        toolName: result.tool,
        toolStatus: "queued",
        subtitle: "Saved to Drive when ready. Check Work Log for progress.",
        href: result.jobId ? `/admin/tool-runs?highlight=${result.toolRunId}` : undefined,
      },
    };
  }

  if (result.status === "blocked") {
    return {
      type: "tool_result",
      id: result.toolRunId ?? result.tool,
      label: `Could not run ${label}`,
      meta: {
        toolName: result.tool,
        toolStatus: "blocked",
        error: result.error ?? "This employee does not have permission for this action.",
        subtitle: result.error,
      },
    };
  }

  if (result.status === "failed") {
    return {
      type: "tool_result",
      id: result.toolRunId ?? result.tool,
      label: `Failed: ${label}`,
      meta: {
        toolName: result.tool,
        toolStatus: "failed",
        error: result.error ?? "Something went wrong running this action.",
        subtitle: result.error,
      },
    };
  }

  return null;
}

export function mergeToolOutcomeArtifacts(
  results: ToolCallResult[],
  existing: MessageArtifact[],
): MessageArtifact[] {
  const extra = results
    .map(toolOutcomeArtifact)
    .filter((a): a is MessageArtifact => a !== null);
  if (!extra.length) return existing;
  const seen = new Set(existing.map((a) => `${a.type}:${a.id}`));
  const merged = [...existing];
  for (const artifact of extra) {
    const key = `${artifact.type}:${artifact.id}`;
    if (!seen.has(key)) {
      merged.push(artifact);
      seen.add(key);
    }
  }
  return merged;
}
