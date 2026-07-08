import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailAlert } from "../../components/EmailAlert";
import { EmailButton } from "../../components/EmailButton";
import { Illustration } from "../../illustrations/Illustration";
import { getSiteUrl } from "@/lib/site-url";

export type TrialEndingProps = {
  daysLeft: number;
  workspaceName?: string;
  endDate?: string;
  upgradeUrl?: string;
};

export function TrialEnding({ daysLeft, workspaceName, endDate, upgradeUrl }: TrialEndingProps) {
  const url = upgradeUrl ?? `${getSiteUrl()}/settings/billing`;
  return (
    <EmailLayout preview={`Your AdeHQ trial ends in ${daysLeft} days`}>
      <Illustration name="rocket" size={80} />
      <EmailTitle>Your trial ends in {daysLeft} days</EmailTitle>
      <EmailBody>
        {workspaceName ? <><strong>{workspaceName}</strong>&apos;s </> : "Your "}
        AdeHQ trial is wrapping up{endDate ? ` on ${endDate}` : ""}. Upgrade to keep your AI
        employees, memory, and project rooms without interruption.
      </EmailBody>

      <EmailAlert tone="warning" title="Don't lose momentum">
        Upgrade now and everything your workforce has built stays exactly where it is.
      </EmailAlert>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url}>Choose a plan</EmailButton>
      </Section>
    </EmailLayout>
  );
}

TrialEnding.PreviewProps = {
  daysLeft: 3,
  workspaceName: "Acme Inc.",
  endDate: "Jul 11, 2026",
  upgradeUrl: "https://app.adehq.com/settings/billing",
} as TrialEndingProps;

export default TrialEnding;
