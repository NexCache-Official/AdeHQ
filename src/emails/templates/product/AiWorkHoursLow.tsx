import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailAlert } from "../../components/EmailAlert";
import { EmailMetric } from "../../components/EmailMetric";
import { EmailButton } from "../../components/EmailButton";
import { getSiteUrl } from "@/lib/site-url";

export type AiWorkHoursLowProps = {
  workspaceName: string;
  hoursRemaining: number;
  percentRemaining: number;
  ctaUrl?: string;
  unsubscribeUrl?: string;
};

export function AiWorkHoursLow({
  workspaceName,
  hoursRemaining,
  percentRemaining,
  ctaUrl,
  unsubscribeUrl,
}: AiWorkHoursLowProps) {
  const url = ctaUrl ?? `${getSiteUrl()}/settings/billing`;
  return (
    <EmailLayout preview={`AI work hours running low in ${workspaceName}`} unsubscribeUrl={unsubscribeUrl}>
      <EmailTitle>Work hours running low</EmailTitle>
      <EmailBody>
        <strong>{workspaceName}</strong> is close to using up its AI work hours for this period.
        Top up to keep your workforce running without interruption.
      </EmailBody>

      <EmailAlert tone="warning" title="Low balance">
        You have about {hoursRemaining} hours ({percentRemaining}%) remaining.
      </EmailAlert>

      <EmailMetric
        metrics={[
          { label: "Hours left", value: `${hoursRemaining}h` },
          { label: "Remaining", value: `${percentRemaining}%` },
        ]}
      />

      <Section style={{ margin: "8px 0 4px" }}>
        <EmailButton href={url}>Manage plan &amp; top up</EmailButton>
      </Section>
    </EmailLayout>
  );
}

AiWorkHoursLow.PreviewProps = {
  workspaceName: "Acme Inc.",
  hoursRemaining: 8,
  percentRemaining: 12,
  ctaUrl: "https://app.adehq.com/settings/billing",
} as AiWorkHoursLowProps;

export default AiWorkHoursLow;
