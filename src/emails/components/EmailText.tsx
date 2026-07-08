import * as React from "react";
import { Heading, Text } from "@react-email/components";
import { colors, fontSize } from "../theme";

const h1: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: fontSize.xxl,
  fontWeight: 700,
  color: colors.heading,
  lineHeight: "34px",
  letterSpacing: "-0.01em",
};

const body: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: fontSize.md,
  color: colors.body,
  lineHeight: "24px",
};

const muted: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: fontSize.sm,
  color: colors.muted,
  lineHeight: "20px",
};

/** Page-level email title. */
export function EmailTitle({ children }: { children: React.ReactNode }) {
  return (
    <Heading as="h1" style={h1}>
      {children}
    </Heading>
  );
}

export function EmailBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <Text style={{ ...body, ...style }}>{children}</Text>;
}

export function EmailMuted({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <Text style={{ ...muted, ...style }}>{children}</Text>;
}
