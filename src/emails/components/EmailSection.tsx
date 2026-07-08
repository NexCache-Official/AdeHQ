import * as React from "react";
import { Heading, Section, Text } from "@react-email/components";
import { colors, fontSize } from "../theme";

const heading: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: fontSize.lg,
  fontWeight: 600,
  color: colors.heading,
  lineHeight: "26px",
};

const eyebrow: React.CSSProperties = {
  margin: "0 0 4px",
  fontSize: fontSize.xs,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.accent,
};

/** A titled content block. Use `eyebrow` for a small kicker above the title. */
export function EmailSection({
  title,
  eyebrow: eyebrowText,
  children,
  style,
}: {
  title?: string;
  eyebrow?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Section style={{ marginTop: "8px", marginBottom: "8px", ...style }}>
      {eyebrowText ? <Text style={eyebrow}>{eyebrowText}</Text> : null}
      {title ? <Heading as="h2" style={heading}>{title}</Heading> : null}
      {children}
    </Section>
  );
}

export default EmailSection;
