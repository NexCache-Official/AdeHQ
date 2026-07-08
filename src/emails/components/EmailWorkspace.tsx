import * as React from "react";
import { Column, Row, Text } from "@react-email/components";
import { colors, fontSize, radius, spacing } from "../theme";
import { EmailAvatar } from "./EmailAvatar";

/** A workspace identity chip: icon/initials + name + optional subtitle. */
export function EmailWorkspace({
  name,
  subtitle,
  iconSrc,
}: {
  name: string;
  subtitle?: string;
  iconSrc?: string;
}) {
  return (
    <Row
      style={{
        backgroundColor: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Column style={{ width: "52px", verticalAlign: "middle" }}>
        <EmailAvatar name={name} src={iconSrc} size={40} />
      </Column>
      <Column style={{ verticalAlign: "middle" }}>
        <Text style={{ margin: 0, fontSize: fontSize.md, fontWeight: 600, color: colors.heading }}>
          {name}
        </Text>
        {subtitle ? (
          <Text style={{ margin: "2px 0 0", fontSize: fontSize.sm, color: colors.muted }}>
            {subtitle}
          </Text>
        ) : null}
      </Column>
    </Row>
  );
}

export default EmailWorkspace;
