import type { MessageArtifact } from "@/lib/types";
import { calendarEntityHref } from "@/lib/calendar/client";

export function contentCampaignArtifact(params: {
  campaignId: string;
  name: string;
  status?: string;
}): MessageArtifact {
  return {
    type: "artifact",
    id: params.campaignId,
    label: params.name,
    meta: {
      href: calendarEntityHref("campaign", params.campaignId),
      subtitle: params.status ?? undefined,
    },
  };
}

export function contentPostArtifact(params: {
  postId: string;
  title: string;
  platform?: string;
  status?: string;
}): MessageArtifact {
  return {
    type: "artifact",
    id: params.postId,
    label: params.title,
    meta: {
      href: calendarEntityHref("post", params.postId),
      subtitle: [params.platform, params.status].filter(Boolean).join(" · ") || undefined,
    },
  };
}
