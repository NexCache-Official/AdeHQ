import * as React from "react";
import { Hr, Link, Section, Text } from "@react-email/components";
import { getSiteUrl } from "@/lib/site-url";
import { colors, fontSize, spacing } from "../theme";

const wrap: React.CSSProperties = {
  padding: `${spacing.lg} 12px 0`,
  textAlign: "center",
};

const divider: React.CSSProperties = {
  borderColor: colors.border,
  borderTopWidth: "1px",
  margin: `${spacing.md} auto ${spacing.md}`,
  width: "100%",
  maxWidth: "320px",
};

const brandLine: React.CSSProperties = {
  margin: "0 0 4px",
  fontSize: fontSize.sm,
  lineHeight: "20px",
};

const navLine: React.CSSProperties = {
  margin: `0 0 ${spacing.sm}`,
  fontSize: fontSize.xs,
  lineHeight: "18px",
};

const legalLine: React.CSSProperties = {
  margin: 0,
  fontSize: "11px",
  color: colors.faint,
  lineHeight: "17px",
  maxWidth: "420px",
  marginLeft: "auto",
  marginRight: "auto",
};

const brandLink: React.CSSProperties = {
  color: colors.heading,
  fontWeight: 600,
  textDecoration: "none",
};

const navLink: React.CSSProperties = {
  color: colors.muted,
  textDecoration: "underline",
};

const tagline: React.CSSProperties = {
  color: colors.muted,
  fontWeight: 400,
};

const legalTagline: React.CSSProperties = {
  color: colors.muted,
};

export function EmailFooter({ unsubscribeUrl }: { unsubscribeUrl?: string }) {
  const site = getSiteUrl();
  const year = new Date().getFullYear();

  return (
    <Section style={wrap}>
      <Text style={brandLine}>
        <Link href={site} style={brandLink}>
          AdeHQ
        </Link>
        <span style={tagline}> · Hire employees, not models.</span>
      </Text>

      <Text style={navLine}>
        {unsubscribeUrl ? (
          <>
            <Link href={`${site}/settings/notifications`} style={navLink}>
              Manage email preferences
            </Link>
            {"  ·  "}
            <Link href={unsubscribeUrl} style={navLink}>
              Unsubscribe
            </Link>
          </>
        ) : (
          <Link href={`${site}/settings`} style={navLink}>
            Account settings
          </Link>
        )}
      </Text>

      <Hr style={divider} />

      <Text style={legalLine}>
        © {year} NexCache Limited · Trading as AdeHQ · All rights reserved
        <span style={legalTagline}> — Hire employees, not models.</span>
      </Text>
    </Section>
  );
}

export default EmailFooter;
