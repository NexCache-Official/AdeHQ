import * as React from "react";
import { Column, Row, Section, Text } from "@react-email/components";
import { colors, fontSize } from "../theme";
import { EmailAvatar } from "./EmailAvatar";

export type ActivityItem = {
  actor: string;
  action: string;
  detail?: string;
  timestamp?: string;
  avatarSrc?: string;
};

export function EmailActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Section>
      {items.map((item, i) => (
        <Row key={i} style={{ marginBottom: i < items.length - 1 ? "14px" : 0 }}>
          <Column style={{ width: "44px", verticalAlign: "top" }}>
            <EmailAvatar name={item.actor} src={item.avatarSrc} size={36} />
          </Column>
          <Column style={{ verticalAlign: "top" }}>
            <Text style={{ margin: 0, fontSize: fontSize.sm, color: colors.body, lineHeight: "19px" }}>
              <span style={{ fontWeight: 600, color: colors.heading }}>{item.actor}</span> {item.action}
              {item.detail ? (
                <>
                  {" "}
                  <span style={{ color: colors.muted }}>{item.detail}</span>
                </>
              ) : null}
            </Text>
            {item.timestamp ? (
              <Text style={{ margin: "2px 0 0", fontSize: fontSize.xs, color: colors.faint }}>
                {item.timestamp}
              </Text>
            ) : null}
          </Column>
        </Row>
      ))}
    </Section>
  );
}

export default EmailActivity;
