import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailCard } from "../../components/EmailCard";
import { EmailButton } from "../../components/EmailButton";
import { Illustration } from "../../illustrations/Illustration";
import { colors, fontSize } from "../../theme";
import { getSiteUrl } from "@/lib/site-url";

export type BrowserResearchFinishedProps = {
  title: string;
  employeeName?: string;
  summary?: string;
  ctaUrl?: string;
  unsubscribeUrl?: string;
};

export function BrowserResearchFinished({
  title,
  employeeName,
  summary,
  ctaUrl,
  unsubscribeUrl,
}: BrowserResearchFinishedProps) {
  const url = ctaUrl ?? `${getSiteUrl()}/`;
  return (
    <EmailLayout preview={`Research ready: ${title}`} unsubscribeUrl={unsubscribeUrl}>
      <Illustration name="search" size={80} />
      <EmailTitle>Research is ready</EmailTitle>
      <EmailBody>
        {employeeName ? <strong>{employeeName}</strong> : "Your AI employee"} finished the browser
        research you requested.
      </EmailBody>

      <EmailCard tone="soft">
        <p style={{ margin: "0 0 6px", fontSize: fontSize.md, fontWeight: 600, color: colors.heading }}>
          {title}
        </p>
        {summary ? (
          <p style={{ margin: 0, fontSize: fontSize.sm, color: colors.body, lineHeight: "20px" }}>
            {summary}
          </p>
        ) : null}
      </EmailCard>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url}>View findings</EmailButton>
      </Section>
    </EmailLayout>
  );
}

BrowserResearchFinished.PreviewProps = {
  title: "Top 5 competitors in AI hiring",
  employeeName: "Maya",
  summary: "Compiled pricing, positioning, and notable gaps across five competitors with sources.",
  ctaUrl: "https://app.adehq.com/",
} as BrowserResearchFinishedProps;

export default BrowserResearchFinished;
