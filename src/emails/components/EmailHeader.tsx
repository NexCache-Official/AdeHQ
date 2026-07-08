import * as React from "react";
import { Img, Section } from "@react-email/components";
import { brandAssets } from "../assets";
import { colors } from "../theme";

const wrap: React.CSSProperties = {
  padding: "24px 32px 0",
  backgroundColor: colors.card,
};

export function EmailHeader({ compact }: { compact?: boolean }) {
  return (
    <Section style={wrap}>
      {compact ? (
        <Img
          src={brandAssets.icon()}
          width="34"
          height="34"
          alt="AdeHQ"
          style={{ display: "block" }}
        />
      ) : (
        <Img
          src={brandAssets.lockup()}
          height="30"
          alt="AdeHQ"
          style={{ display: "block" }}
        />
      )}
    </Section>
  );
}

export default EmailHeader;
