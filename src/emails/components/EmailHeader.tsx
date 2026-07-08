import * as React from "react";
import { Img, Section } from "@react-email/components";
import { brandAssets } from "../assets";
import { colors } from "../theme";

const wrap: React.CSSProperties = {
  padding: "28px 32px 0",
  backgroundColor: colors.card,
  textAlign: "center",
};

export function EmailHeader({ compact }: { compact?: boolean }) {
  return (
    <Section style={wrap}>
      {compact ? (
        <Img
          src={brandAssets.icon()}
          width="48"
          height="48"
          alt="AdeHQ"
          style={{ display: "inline-block" }}
        />
      ) : (
        <Img
          src={brandAssets.lockup()}
          height="54"
          alt="AdeHQ"
          style={{ display: "inline-block" }}
        />
      )}
    </Section>
  );
}

export default EmailHeader;
