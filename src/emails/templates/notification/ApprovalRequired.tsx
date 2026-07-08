import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailCard } from "../../components/EmailCard";
import { EmailButton } from "../../components/EmailButton";
import { EmailBadge } from "../../components/EmailBadge";
import { colors, fontSize } from "../../theme";
import { getSiteUrl } from "@/lib/site-url";

export type ApprovalRequiredProps = {
  actionTitle: string;
  employeeName?: string;
  detail?: string;
  riskLevel?: "low" | "medium" | "high";
  ctaUrl?: string;
  unsubscribeUrl?: string;
};

export function ApprovalRequired({
  actionTitle,
  employeeName,
  detail,
  riskLevel = "medium",
  ctaUrl,
  unsubscribeUrl,
}: ApprovalRequiredProps) {
  const url = ctaUrl ?? `${getSiteUrl()}/approvals`;
  const tone = riskLevel === "high" ? "error" : riskLevel === "low" ? "neutral" : "warning";
  return (
    <EmailLayout preview={`Approval needed: ${actionTitle}`} unsubscribeUrl={unsubscribeUrl}>
      <EmailTitle>Approval needed</EmailTitle>
      <EmailBody>
        {employeeName ? <strong>{employeeName}</strong> : "One of your AI employees"} wants to take
        an action that needs your sign-off before proceeding.
      </EmailBody>

      <EmailCard tone="soft">
        <p style={{ margin: "0 0 8px" }}>
          <EmailBadge tone={tone}>{riskLevel} risk</EmailBadge>
        </p>
        <p style={{ margin: "0 0 4px", fontSize: fontSize.md, fontWeight: 600, color: colors.heading }}>
          {actionTitle}
        </p>
        {detail ? (
          <p style={{ margin: 0, fontSize: fontSize.sm, color: colors.body, lineHeight: "20px" }}>
            {detail}
          </p>
        ) : null}
      </EmailCard>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url}>Review &amp; approve</EmailButton>
      </Section>
    </EmailLayout>
  );
}

ApprovalRequired.PreviewProps = {
  actionTitle: "Send outreach email to 42 leads",
  employeeName: "Leo",
  detail: "Leo drafted a cold outreach campaign and is ready to send it to the imported lead list.",
  riskLevel: "high",
  ctaUrl: "https://app.adehq.com/approvals",
} as ApprovalRequiredProps;

export default ApprovalRequired;
