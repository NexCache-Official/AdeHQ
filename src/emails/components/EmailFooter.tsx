import * as React from "react";
import { Link, Section, Text } from "@react-email/components";
import { getSiteUrl } from "@/lib/site-url";
import { colors, fontSize } from "../theme";

const wrap: React.CSSProperties = {
  padding: "24px 12px 0",
  textAlign: "center",
};

const line: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: fontSize.xs,
  color: colors.faint,
  lineHeight: "18px",
};

const link: React.CSSProperties = {
  color: colors.muted,
  textDecoration: "underline",
};

export function EmailFooter({ unsubscribeUrl }: { unsubscribeUrl?: string }) {
  const site = getSiteUrl();
  return (
    <Section style={wrap}>
      <Text style={line}>
        <Link href={site} style={{ ...link, fontWeight: 600, color: colors.body }}>
          AdeHQ
        </Link>{" "}
        · Your company&apos;s AI headquarters
      </Text>
      <Text style={line}>
        {unsubscribeUrl ? (
          <>
            <Link href={`${site}/settings/notifications`} style={link}>
              Manage email preferences
            </Link>
            {"  ·  "}
            <Link href={unsubscribeUrl} style={link}>
              Unsubscribe
            </Link>
          </>
        ) : (
          <Link href={`${site}/settings`} style={link}>
            Account settings
          </Link>
        )}
      </Text>
      <Text style={{ ...line, color: colors.faint }}>
        © {new Date().getFullYear()} AdeHQ. All rights reserved.
      </Text>
    </Section>
  );
}

export default EmailFooter;
