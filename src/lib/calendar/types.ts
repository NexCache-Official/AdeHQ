export type ContentPlatform = "linkedin" | "instagram" | "facebook" | "x" | "blog" | "email";

export type ContentPostStatus =
  | "draft"
  | "ready_for_approval"
  | "approved"
  | "scheduled_later"
  | "published_later"
  | "archived";

export type ContentCampaign = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "completed" | "archived";
  startDate: string | null;
  endDate: string | null;
  ownerEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContentPost = {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  title: string;
  body: string;
  status: ContentPostStatus;
  scheduledAt: string | null;
  platform: ContentPlatform;
  approvalId: string | null;
  artifactId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalendarListPayload = {
  campaigns: ContentCampaign[];
  posts: ContentPost[];
};
