import * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
} from "@react-email/components";
import { colors, fonts, layout } from "../theme";
import { EmailHeader } from "../components/EmailHeader";
import { EmailFooter } from "../components/EmailFooter";

export type EmailLayoutProps = {
  /** Inbox preview line (hidden preheader). */
  preview: string;
  children: React.ReactNode;
  /** Preference-gated emails pass an unsubscribe URL for the footer link. */
  unsubscribeUrl?: string;
  /** Compact header uses the icon mark instead of the full lockup. */
  compactHeader?: boolean;
};

const main: React.CSSProperties = {
  backgroundColor: colors.background,
  fontFamily: fonts.sans,
  margin: 0,
  padding: 0,
  WebkitTextSizeAdjust: "100%",
};

const container: React.CSSProperties = {
  maxWidth: layout.maxWidth,
  margin: "0 auto",
  padding: "24px 12px 40px",
};

const cardShell: React.CSSProperties = {
  backgroundColor: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: "16px",
  overflow: "hidden",
};

const contentPad: React.CSSProperties = {
  padding: layout.contentPadding,
};

export function EmailLayout({
  preview,
  children,
  unsubscribeUrl,
  compactHeader,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <div style={cardShell}>
            <EmailHeader compact={compactHeader} />
            <Section style={contentPad}>{children}</Section>
          </div>
          <EmailFooter unsubscribeUrl={unsubscribeUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export default EmailLayout;
