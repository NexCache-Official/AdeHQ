import * as React from "react";
import { Section, Text } from "@react-email/components";
import { colors, fontSize } from "../theme";

/** A short sign-off block. Defaults to the AdeHQ team voice. */
export function EmailSignature({
  from = "The AdeHQ team",
  closing = "— Talk soon,",
}: {
  from?: string;
  closing?: string;
}) {
  return (
    <Section style={{ marginTop: "24px" }}>
      <Text style={{ margin: 0, fontSize: fontSize.base, color: colors.body, lineHeight: "22px" }}>
        {closing}
      </Text>
      <Text style={{ margin: "2px 0 0", fontSize: fontSize.base, fontWeight: 600, color: colors.heading }}>
        {from}
      </Text>
    </Section>
  );
}

export default EmailSignature;
