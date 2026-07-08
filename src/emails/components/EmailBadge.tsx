import * as React from "react";
import { colors, fontSize, radius } from "../theme";

type Tone = "accent" | "neutral" | "success" | "warning" | "error";

const tones: Record<Tone, React.CSSProperties> = {
  accent: { backgroundColor: colors.accentSoft, color: colors.accentDark, border: `1px solid ${colors.accentBorder}` },
  neutral: { backgroundColor: colors.background, color: colors.muted, border: `1px solid ${colors.border}` },
  success: { backgroundColor: colors.successSoft, color: colors.success, border: `1px solid ${colors.successBorder}` },
  warning: { backgroundColor: colors.warningSoft, color: colors.warning, border: `1px solid ${colors.warningBorder}` },
  error: { backgroundColor: colors.errorSoft, color: colors.error, border: `1px solid ${colors.errorBorder}` },
};

export function EmailBadge({
  children,
  tone = "accent",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: radius.full,
        fontSize: fontSize.xs,
        fontWeight: 600,
        lineHeight: "16px",
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}

export default EmailBadge;
