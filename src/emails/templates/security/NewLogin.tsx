import * as React from "react";
import { Section, Text } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailCard } from "../../components/EmailCard";
import { EmailButton } from "../../components/EmailButton";
import { colors, fontSize } from "../../theme";
import { getSiteUrl } from "@/lib/site-url";

export type NewLoginProps = {
  device?: string;
  location?: string;
  ipAddress?: string;
  timestamp?: string;
  secureUrl?: string;
};

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Text style={{ margin: "0 0 6px", fontSize: fontSize.sm, color: colors.body }}>
      <span style={{ color: colors.muted }}>{label}: </span>
      <span style={{ fontWeight: 600, color: colors.heading }}>{value}</span>
    </Text>
  );
}

export function NewLogin({ device, location, ipAddress, timestamp, secureUrl }: NewLoginProps) {
  const url = secureUrl ?? `${getSiteUrl()}/settings`;
  return (
    <EmailLayout preview="New sign-in to your AdeHQ account">
      <EmailTitle>New sign-in detected</EmailTitle>
      <EmailBody>
        Your AdeHQ account was just accessed from a new device or location. If this was you, no
        action is needed.
      </EmailBody>

      <EmailCard tone="soft">
        <Detail label="When" value={timestamp} />
        <Detail label="Device" value={device} />
        <Detail label="Location" value={location} />
        <Detail label="IP address" value={ipAddress} />
      </EmailCard>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url} variant="secondary">
          Review account security
        </EmailButton>
      </Section>

      <Text style={{ margin: "20px 0 0", fontSize: fontSize.sm, color: colors.muted, lineHeight: "20px" }}>
        If this wasn&apos;t you, reset your password immediately and review your active sessions.
      </Text>
    </EmailLayout>
  );
}

NewLogin.PreviewProps = {
  device: "Chrome on macOS",
  location: "San Francisco, US",
  ipAddress: "203.0.113.42",
  timestamp: "Jul 8, 2026 · 09:14 UTC",
  secureUrl: "https://app.adehq.com/settings",
} as NewLoginProps;

export default NewLogin;
