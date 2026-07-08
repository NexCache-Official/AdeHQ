import * as React from "react";
import { Hr } from "@react-email/components";
import { colors } from "../theme";

export function EmailDivider({ style }: { style?: React.CSSProperties }) {
  return (
    <Hr
      style={{
        border: "none",
        borderTop: `1px solid ${colors.border}`,
        margin: "20px 0",
        ...style,
      }}
    />
  );
}

export default EmailDivider;
