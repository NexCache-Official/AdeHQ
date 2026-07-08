import * as React from "react";
import { Section, Text } from "@react-email/components";
import { colors, fontSize } from "../theme";
import { Illustration } from "../illustrations/Illustration";
import type { IllustrationName } from "../assets";

/** Centered empty-state pattern for "nothing happened this period" emails. */
export function EmailEmptyState({
  illustration = "empty",
  title,
  description,
}: {
  illustration?: IllustrationName;
  title: string;
  description?: string;
}) {
  return (
    <Section style={{ textAlign: "center", padding: "16px 0" }}>
      <Illustration name={illustration} size={72} />
      <Text style={{ margin: "8px 0 4px", fontSize: fontSize.md, fontWeight: 600, color: colors.heading }}>
        {title}
      </Text>
      {description ? (
        <Text style={{ margin: 0, fontSize: fontSize.sm, color: colors.muted, lineHeight: "20px" }}>
          {description}
        </Text>
      ) : null}
    </Section>
  );
}

export default EmailEmptyState;
