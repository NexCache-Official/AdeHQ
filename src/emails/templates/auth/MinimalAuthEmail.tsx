import * as React from "react";
import { Section, Text } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailButton } from "../../components/EmailButton";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { colors, fontSize } from "../../theme";

/**
 * Shared scaffold for the deliberately-minimal auth/security emails: brand
 * header, one short line of context, a single primary CTA, and a small
 * security note with expiry. No illustrations, no marketing.
 */
export function MinimalAuthEmail({
  preview,
  title,
  intro,
  actionLabel,
  actionUrl,
  securityNote,
  expiresInMinutes,
  children,
}: {
  preview: string;
  title: string;
  intro: React.ReactNode;
  actionLabel: string;
  actionUrl: string;
  securityNote?: React.ReactNode;
  expiresInMinutes?: number;
  children?: React.ReactNode;
}) {
  return (
    <EmailLayout preview={preview}>
      <EmailTitle>{title}</EmailTitle>
      <EmailBody>{intro}</EmailBody>

      <Section style={{ margin: "8px 0 4px" }}>
        <EmailButton href={actionUrl}>{actionLabel}</EmailButton>
      </Section>

      {children}

      <Text style={{ margin: "20px 0 0", fontSize: fontSize.sm, color: colors.muted, lineHeight: "20px" }}>
        {expiresInMinutes ? (
          <>This link expires in {expiresInMinutes} minutes. </>
        ) : null}
        {securityNote ?? (
          <>If you didn&apos;t request this, you can safely ignore this email.</>
        )}
      </Text>

      <Text style={{ margin: "16px 0 0", fontSize: fontSize.xs, color: colors.faint, lineHeight: "18px" }}>
        Trouble with the button? Copy and paste this URL into your browser:
        <br />
        <span style={{ color: colors.muted, wordBreak: "break-all" }}>{actionUrl}</span>
      </Text>
    </EmailLayout>
  );
}

export default MinimalAuthEmail;
