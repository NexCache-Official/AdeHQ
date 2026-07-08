import * as React from "react";
import { Section, Text } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailCard } from "../../components/EmailCard";
import { EmailButton } from "../../components/EmailButton";
import { colors, fontSize } from "../../theme";
import { getSiteUrl } from "@/lib/site-url";

export type PaymentSucceededProps = {
  amount: string;
  planName: string;
  periodLabel?: string;
  invoiceUrl?: string;
  billingUrl?: string;
};

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Text style={{ margin: "0 0 6px", fontSize: fontSize.sm, color: colors.body }}>
      <span style={{ color: colors.muted }}>{label}: </span>
      <span style={{ fontWeight: 600, color: colors.heading }}>{value}</span>
    </Text>
  );
}

export function PaymentSucceeded({
  amount,
  planName,
  periodLabel,
  invoiceUrl,
  billingUrl,
}: PaymentSucceededProps) {
  const url = invoiceUrl ?? billingUrl ?? `${getSiteUrl()}/settings/billing`;
  return (
    <EmailLayout preview="Payment received — thank you">
      <EmailTitle>Payment received</EmailTitle>
      <EmailBody>Thanks — your payment went through and your AdeHQ plan is active.</EmailBody>

      <EmailCard tone="soft">
        <Line label="Plan" value={planName} />
        <Line label="Amount" value={amount} />
        {periodLabel ? <Line label="Period" value={periodLabel} /> : null}
      </EmailCard>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url} variant="secondary">
          View invoice
        </EmailButton>
      </Section>
    </EmailLayout>
  );
}

PaymentSucceeded.PreviewProps = {
  amount: "$99.00",
  planName: "AdeHQ Scale",
  periodLabel: "Jul 8 – Aug 8, 2026",
  invoiceUrl: "https://app.adehq.com/settings/billing",
} as PaymentSucceededProps;

export default PaymentSucceeded;
