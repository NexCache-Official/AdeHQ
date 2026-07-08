import * as React from "react";
import { Button } from "@react-email/components";
import { colors, fontSize, radius } from "../theme";

type Variant = "primary" | "secondary" | "ghost";

const base: React.CSSProperties = {
  display: "inline-block",
  fontSize: fontSize.base,
  fontWeight: 600,
  lineHeight: "20px",
  textDecoration: "none",
  textAlign: "center",
  padding: "13px 26px",
  borderRadius: radius.md,
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: {
    backgroundColor: colors.accent,
    color: colors.onAccent,
    border: `1px solid ${colors.accent}`,
  },
  secondary: {
    backgroundColor: colors.card,
    color: colors.accent,
    border: `1px solid ${colors.accentBorder}`,
  },
  ghost: {
    backgroundColor: "transparent",
    color: colors.accent,
    border: "1px solid transparent",
  },
};

export function EmailButton({
  href,
  children,
  variant = "primary",
  style,
}: {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  style?: React.CSSProperties;
}) {
  return (
    <Button href={href} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </Button>
  );
}

export default EmailButton;
