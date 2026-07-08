import * as React from "react";
import { Column, Row, Text } from "@react-email/components";
import { colors, fontSize, radius, spacing } from "../theme";
import { EmailAvatar } from "./EmailAvatar";
import { EmailBadge } from "./EmailBadge";

/** An AI-employee identity card: avatar + name + role, with optional status. */
export function EmailEmployee({
  name,
  role,
  avatarSrc,
  status,
}: {
  name: string;
  role: string;
  avatarSrc?: string;
  status?: string;
}) {
  return (
    <Row
      style={{
        backgroundColor: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Column style={{ width: "56px", verticalAlign: "middle" }}>
        <EmailAvatar name={name} src={avatarSrc} size={44} />
      </Column>
      <Column style={{ verticalAlign: "middle" }}>
        <Text style={{ margin: 0, fontSize: fontSize.md, fontWeight: 600, color: colors.heading }}>
          {name}
        </Text>
        <Text style={{ margin: "2px 0 0", fontSize: fontSize.sm, color: colors.muted }}>
          {role}
        </Text>
      </Column>
      {status ? (
        <Column style={{ verticalAlign: "middle", textAlign: "right" }}>
          <EmailBadge tone="success">{status}</EmailBadge>
        </Column>
      ) : null}
    </Row>
  );
}

export default EmailEmployee;
