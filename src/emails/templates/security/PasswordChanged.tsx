import * as React from "react";
import { Section, Text } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailAlert } from "../../components/EmailAlert";
import { EmailButton } from "../../components/EmailButton";
import { colors, fontSize } from "../../theme";
import { getSiteUrl } from "@/lib/site-url";

export type PasswordChangedProps = {
  timestamp?: string;
  resetUrl?: string;
};

export function PasswordChanged({ timestamp, resetUrl }: PasswordChangedProps) {
  const url = resetUrl ?? `${getSiteUrl()}/login`;
  return (
    <EmailLayout preview="Your AdeHQ password was changed">
      <EmailTitle>Your password was changed</EmailTitle>
      <EmailBody>
        The password for your AdeHQ account was just updated{timestamp ? ` on ${timestamp}` : ""}.
        If you made this change, you&apos;re all set.
      </EmailBody>

      <EmailAlert tone="info" title="Didn't change your password?">
        Reset it immediately to lock your account back down.
      </EmailAlert>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url} variant="secondary">
          Secure my account
        </EmailButton>
      </Section>

      <Text style={{ margin: "20px 0 0", fontSize: fontSize.sm, color: colors.muted, lineHeight: "20px" }}>
        For your security, this is an automated notification and can&apos;t be turned off.
      </Text>
    </EmailLayout>
  );
}

PasswordChanged.PreviewProps = {
  timestamp: "Jul 8, 2026 · 09:14 UTC",
  resetUrl: "https://app.adehq.com/login",
} as PasswordChangedProps;

export default PasswordChanged;
