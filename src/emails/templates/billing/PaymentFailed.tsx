import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailAlert } from "../../components/EmailAlert";
import { EmailButton } from "../../components/EmailButton";
import { getSiteUrl } from "@/lib/site-url";

export type PaymentFailedProps = {
  amount: string;
  planName: string;
  retryDate?: string;
  billingUrl?: string;
};

export function PaymentFailed({ amount, planName, retryDate, billingUrl }: PaymentFailedProps) {
  const url = billingUrl ?? `${getSiteUrl()}/settings/billing`;
  return (
    <EmailLayout preview="Action needed: your AdeHQ payment failed">
      <EmailTitle>Payment failed</EmailTitle>
      <EmailBody>
        We couldn&apos;t process your {amount} payment for <strong>{planName}</strong>. Update your
        payment method to keep your AI workforce running.
      </EmailBody>

      <EmailAlert tone="error" title="Your plan is at risk">
        {retryDate
          ? `We'll try again on ${retryDate}. Update your card before then to avoid interruption.`
          : "Update your card to avoid an interruption to your workforce."}
      </EmailAlert>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url}>Update payment method</EmailButton>
      </Section>
    </EmailLayout>
  );
}

PaymentFailed.PreviewProps = {
  amount: "$99.00",
  planName: "AdeHQ Scale",
  retryDate: "Jul 11, 2026",
  billingUrl: "https://app.adehq.com/settings/billing",
} as PaymentFailedProps;

export default PaymentFailed;
