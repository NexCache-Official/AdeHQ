import * as React from "react";
import { Column, Row, Section, Text } from "@react-email/components";
import { colors, fontSize, radius } from "../theme";

export type Metric = {
  label: string;
  value: string | number;
  hint?: string;
};

const cell: React.CSSProperties = {
  backgroundColor: colors.background,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: "14px 16px",
  verticalAlign: "top",
};

const value: React.CSSProperties = {
  margin: 0,
  fontSize: fontSize.xl,
  fontWeight: 700,
  color: colors.heading,
  lineHeight: "28px",
};

const label: React.CSSProperties = {
  margin: "2px 0 0",
  fontSize: fontSize.xs,
  color: colors.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

/** A responsive-ish grid of metric tiles (2 per row via table columns). */
export function EmailMetric({ metrics }: { metrics: Metric[] }) {
  const rows: Metric[][] = [];
  for (let i = 0; i < metrics.length; i += 2) {
    rows.push(metrics.slice(i, i + 2));
  }
  return (
    <Section style={{ marginTop: "12px", marginBottom: "12px" }}>
      {rows.map((pair, i) => (
        <Row key={i} style={{ marginBottom: "8px" }}>
          {pair.map((m, j) => (
            <Column key={j} style={{ width: "50%", padding: j === 0 ? "0 4px 0 0" : "0 0 0 4px" }}>
              <div style={cell}>
                <Text style={value}>{m.value}</Text>
                <Text style={label}>{m.label}</Text>
                {m.hint ? (
                  <Text style={{ margin: "4px 0 0", fontSize: fontSize.xs, color: colors.faint }}>
                    {m.hint}
                  </Text>
                ) : null}
              </div>
            </Column>
          ))}
          {pair.length === 1 ? <Column style={{ width: "50%" }} /> : null}
        </Row>
      ))}
    </Section>
  );
}

export default EmailMetric;
