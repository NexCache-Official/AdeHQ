import * as React from "react";
import { Section, Text } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { colors, fonts, fontSize, radius } from "../../theme";

export type ReauthenticationProps = {
  token: string;
  expiresInMinutes?: number;
};

const codeBox: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: colors.background,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md,
  padding: "14px 24px",
  fontFamily: fonts.mono,
  fontSize: "30px",
  fontWeight: 700,
  letterSpacing: "0.28em",
  color: colors.heading,
};

export function Reauthentication({ token, expiresInMinutes = 10 }: ReauthenticationProps) {
  return (
    <EmailLayout preview="Your AdeHQ verification code">
      <EmailTitle>Verification code</EmailTitle>
      <EmailBody>
        Enter this code to confirm it&apos;s really you. It keeps sensitive actions on your
        account secure.
      </EmailBody>

      <Section style={{ textAlign: "center", margin: "8px 0 4px" }}>
        <span style={codeBox}>{token}</span>
      </Section>

      <Text style={{ margin: "20px 0 0", fontSize: fontSize.sm, color: colors.muted, lineHeight: "20px" }}>
        This code expires in {expiresInMinutes} minutes. If you didn&apos;t request it, ignore this
        email and consider resetting your password.
      </Text>
    </EmailLayout>
  );
}

Reauthentication.PreviewProps = {
  token: "824193",
  expiresInMinutes: 10,
} as ReauthenticationProps;

export default Reauthentication;
