import * as React from "react";
import { Section } from "@react-email/components";
import { colors, radius, spacing } from "../theme";

const card: React.CSSProperties = {
  backgroundColor: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: spacing.lg,
  marginTop: spacing.md,
  marginBottom: spacing.md,
};

const soft: React.CSSProperties = {
  ...card,
  backgroundColor: colors.background,
};

export function EmailCard({
  children,
  tone = "plain",
  style,
}: {
  children: React.ReactNode;
  tone?: "plain" | "soft";
  style?: React.CSSProperties;
}) {
  return (
    <Section style={{ ...(tone === "soft" ? soft : card), ...style }}>
      {children}
    </Section>
  );
}

export default EmailCard;
