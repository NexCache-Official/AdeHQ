import type { MessageArtifact } from "@/lib/types";
import { investorEntityHref } from "@/lib/investors/client";

export function investorFirmArtifact(params: {
  firmId: string;
  name: string;
  stageFocus?: string | null;
  website?: string | null;
}): MessageArtifact {
  return {
    type: "artifact",
    id: params.firmId,
    label: params.name,
    meta: {
      href: investorEntityHref("firm", params.firmId),
      subtitle: [params.stageFocus, params.website].filter(Boolean).join(" · ") || undefined,
    },
  };
}

export function investorContactArtifact(params: {
  contactId: string;
  fullName: string;
  firmName?: string | null;
  email?: string | null;
}): MessageArtifact {
  return {
    type: "artifact",
    id: params.contactId,
    label: params.fullName,
    meta: {
      href: investorEntityHref("contact", params.contactId),
      subtitle: [params.firmName, params.email].filter(Boolean).join(" · ") || undefined,
    },
  };
}

export function investorPipelineArtifact(params: {
  pipelineId: string;
  firmName?: string | null;
  contactName?: string | null;
  stage?: string;
  fitScore?: number | null;
}): MessageArtifact {
  const fitLabel = params.fitScore != null ? `Fit ${params.fitScore}/100` : null;
  return {
    type: "artifact",
    id: params.pipelineId,
    label: params.firmName ?? params.contactName ?? "Investor pipeline",
    meta: {
      href: investorEntityHref("pipeline", params.pipelineId),
      subtitle: [params.stage, fitLabel].filter(Boolean).join(" · ") || undefined,
    },
  };
}
