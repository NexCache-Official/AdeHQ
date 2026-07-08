import * as React from "react";
import { Section, Text } from "@react-email/components";
import { colors, fontSize, radius, spacing } from "../theme";

type Tone = "success" | "warning" | "error" | "info";

const tones: Record<Tone, { bg: string; border: string; text: string; label: string }> = {
  success: { bg: colors.successSoft, border: colors.successBorder, text: colors.success, label: "✓" },
  warning: { bg: colors.warningSoft, border: colors.warningBorder, text: colors.warning, label: "!" },
  error: { bg: colors.errorSoft, border: colors.errorBorder, text: colors.error, label: "✕" },
  info: { bg: colors.infoSoft, border: colors.infoBorder, text: colors.info, label: "i" },
};

export function EmailAlert({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  const t = tones[tone];
  return (
    <Section
      style={{
        backgroundColor: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: radius.md,
        padding: spacing.md,
        marginTop: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      {title ? (
        <Text style={{ margin: "0 0 4px", fontSize: fontSize.sm, fontWeight: 700, color: t.text }}>
          {title}
        </Text>
      ) : null}
      <Text style={{ margin: 0, fontSize: fontSize.sm, color: colors.body, lineHeight: "20px" }}>
        {children}
      </Text>
    </Section>
  );
}

export default EmailAlert;
