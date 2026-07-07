import type { MessageArtifact } from "@/lib/types";
import type { ToolCallEffect, ToolCallResult } from "./types";
import { crmEntityHref } from "@/lib/crm/client";
import { calendarEntityHref } from "@/lib/calendar/client";
import { investorEntityHref } from "@/lib/investors/client";

const TOOL_LABELS: Record<string, string> = {
  "crm.createContact": "CRM contact",
  "crm.createCompany": "CRM company",
  "crm.createDeal": "CRM deal",
  "crm.updateDealStage": "deal stage update",
  "email.createDraft": "email draft",
  "tasks.createTask": "follow-up task",
  "artifact.createSpreadsheet": "spreadsheet",
  "artifact.createPdfReport": "PDF report",
  "artifact.createDocx": "Word document",
  "artifact.createPresentation": "PowerPoint deck",
  "artifact.updateSpreadsheet": "spreadsheet update",
  "artifact.convertFile": "file conversion",
  "artifact.saveToDrive": "Drive export",
  "social.createCampaign": "campaign",
  "calendar.createCampaign": "campaign",
  "social.draftPost": "social post",
  "calendar.createContentPost": "content post",
  "calendar.scheduleDraft": "schedule post",
  "investor.createFirm": "investor firm",
  "investor.createInvestorContact": "investor contact",
  "investor.updatePipeline": "pipeline update",
  "investor.scoreFit": "fit score",
  "investor.createFollowUp": "investor follow-up",
};

function humanToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.split(".").pop()?.replace(/([A-Z])/g, " $1") ?? tool;
}

function hasArtifactType(result: ToolCallResult, types: string[]): boolean {
  return result.messageArtifacts.some((a) => types.includes(a.type));
}

/** Success / approval receipt cards driven by tool run status — not NL text. */
export function toolReceiptArtifact(result: ToolCallResult): MessageArtifact | null {
  const label = humanToolLabel(result.tool);

  if (result.status === "approval_pending" || (result.status === "preview" && result.approvalId)) {
    if (hasArtifactType(result, ["approval"])) return null;
    const title = result.preview?.title ?? `Prepare ${label}`;
    return {
      type: "tool_result",
      id: result.approvalId ?? result.toolRunId ?? `${result.tool}-approval`,
      label: `Prepared for approval: ${title.replace(/^Create deal — /i, "").replace(/^Create /i, "")}`,
      meta: {
        toolName: result.tool,
        toolStatus: "approval_pending",
        subtitle: "Review and approve before this is saved to CRM.",
      },
    };
  }

  if (result.status === "success") {
    const output = result.output;
    const objectId = output?.objectId;

    if (result.tool.startsWith("crm.") && hasArtifactType(result, ["crm_contact", "crm_deal", "crm_company"])) {
      return null;
    }

    if (result.tool === "tasks.createTask" && objectId) {
      const title = String(output?.payload?.title ?? "Follow-up task");
      return {
        type: "tool_result",
        id: objectId,
        label: `Task created: ${title}`,
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: "/tasks",
          subtitle: "Open in Tasks",
        },
      };
    }

    if (result.tool === "email.createDraft" && objectId) {
      const title = String(output?.payload?.title ?? output?.payload?.subject ?? "Email draft");
      return {
        type: "tool_result",
        id: objectId,
        label: `Email draft: ${title}`,
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: `/drive?artifact=${objectId}`,
          subtitle: "Reviewable draft — not sent",
        },
      };
    }

    if (result.tool === "crm.createContact" && objectId) {
      const name = String(output?.payload?.fullName ?? "Contact");
      return {
        type: "tool_result",
        id: objectId,
        label: `Contact created: ${name}`,
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: crmEntityHref("contact", objectId),
          subtitle: "Open in CRM",
        },
      };
    }

    if (result.tool === "crm.createCompany" && objectId) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? "Company created",
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: crmEntityHref("company", objectId),
          subtitle: "Open in CRM",
        },
      };
    }

    if (result.tool === "crm.createDeal" && objectId) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? `Deal created`,
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: crmEntityHref("deal", objectId),
          subtitle: "Open in CRM",
        },
      };
    }

    if (result.tool === "social.createCampaign" && objectId) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? "Campaign created",
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: calendarEntityHref("campaign", objectId),
          subtitle: "Open in Calendar",
        },
      };
    }

    if (
      (result.tool === "social.draftPost" || result.tool === "calendar.createContentPost") &&
      objectId
    ) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? "Post drafted",
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: calendarEntityHref("post", objectId),
          subtitle: "Open in Calendar",
        },
      };
    }

    if (result.tool === "calendar.scheduleDraft" && objectId) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? "Post scheduled",
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: calendarEntityHref("post", objectId),
          subtitle: "Open in Calendar",
        },
      };
    }

    if (result.tool === "investor.createFirm" && objectId) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? "Firm created",
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: investorEntityHref("firm", objectId),
          subtitle: "Open in Investors",
        },
      };
    }

    if (result.tool === "investor.createInvestorContact" && objectId) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? "Contact created",
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: investorEntityHref("contact", objectId),
          subtitle: "Open in Investors",
        },
      };
    }

    if (
      (result.tool === "investor.updatePipeline" || result.tool === "investor.scoreFit") &&
      objectId
    ) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? "Pipeline updated",
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: investorEntityHref("pipeline", objectId),
          subtitle: "Open in Investors",
        },
      };
    }

    if (
      (result.tool === "artifact.createSpreadsheet" ||
        result.tool === "artifact.createPdfReport" ||
        result.tool === "artifact.createDocx" ||
        result.tool === "artifact.createPresentation" ||
        result.tool === "artifact.convertFile" ||
        result.tool === "artifact.saveToDrive" ||
        result.tool === "artifact.updateSpreadsheet") &&
      objectId
    ) {
      return {
        type: "tool_result",
        id: objectId,
        label: output?.summary ?? `${label} created`,
        meta: {
          toolName: result.tool,
          toolStatus: "success",
          href: `/drive?artifact=${objectId}`,
          subtitle: "Open in Drive",
        },
      };
    }
  }

  return null;
}

/** Inline chat chips for non-success tool outcomes the user must see. */
export function toolOutcomeArtifact(
  result: ToolCallResult,
  retry?: { args?: Record<string, unknown>; idempotencyKey?: string; triggerMessageId?: string },
): MessageArtifact | null {
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
        jobId: result.jobId,
        subtitle: "Saved to Drive when ready. This usually takes a few seconds.",
        href: result.jobId ? `/work-log` : undefined,
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
        toolRunId: result.toolRunId,
        href: result.toolRunId ? `/admin/tool-runs?id=${encodeURIComponent(result.toolRunId)}` : undefined,
        retryArgs: result.inputArgs ?? retry?.args,
        idempotencyKey: retry?.idempotencyKey,
        triggerMessageId: result.triggerMessageId ?? retry?.triggerMessageId,
      },
    };
  }

  return null;
}

export function mergeToolOutcomeArtifacts(
  results: ToolCallResult[],
  existing: MessageArtifact[],
  sourceCalls?: ToolCallEffect[],
  options?: { triggerMessageId?: string },
): MessageArtifact[] {
  const merged = [...existing];
  const seen = new Set(existing.map((a) => `${a.type}:${a.id}`));

  results.forEach((result, index) => {
    const call = sourceCalls?.[index];
    const retry =
      call && result.status === "failed"
        ? {
            args: result.inputArgs ?? call.args,
            idempotencyKey: result.idempotencyKey,
            triggerMessageId: result.triggerMessageId ?? options?.triggerMessageId,
          }
        : undefined;
    for (const artifact of [toolReceiptArtifact(result), toolOutcomeArtifact(result, retry)]) {
      if (!artifact) continue;
      const key = `${artifact.type}:${artifact.id}`;
      if (seen.has(key)) continue;
      merged.push(artifact);
      seen.add(key);
    }
  });

  return merged;
}
