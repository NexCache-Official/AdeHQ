import type { MessageArtifact } from "@/lib/types";
import { crmEntityHref } from "@/lib/crm/client";

export function crmContactArtifact(params: {
  contactId: string;
  fullName: string;
  email?: string | null;
  companyName?: string | null;
}): MessageArtifact {
  return {
    type: "crm_contact",
    id: params.contactId,
    label: params.fullName,
    meta: {
      href: crmEntityHref("contact", params.contactId),
      subtitle: [params.companyName, params.email].filter(Boolean).join(" · ") || undefined,
      email: params.email ?? undefined,
      company: params.companyName ?? undefined,
    },
  };
}

export function crmDealArtifact(params: {
  dealId: string;
  name: string;
  stage?: string;
  amountLabel?: string;
}): MessageArtifact {
  return {
    type: "crm_deal",
    id: params.dealId,
    label: params.name,
    meta: {
      href: crmEntityHref("deal", params.dealId),
      subtitle: [params.stage, params.amountLabel].filter(Boolean).join(" · ") || undefined,
    },
  };
}

export function crmCompanyArtifact(params: {
  companyId: string;
  name: string;
  industry?: string | null;
}): MessageArtifact {
  return {
    type: "crm_company",
    id: params.companyId,
    label: params.name,
    meta: {
      href: crmEntityHref("company", params.companyId),
      subtitle: params.industry ?? undefined,
    },
  };
}
