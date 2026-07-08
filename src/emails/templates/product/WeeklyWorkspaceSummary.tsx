import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailSection } from "../../components/EmailSection";
import { EmailMetric, type Metric } from "../../components/EmailMetric";
import { EmailActivity, type ActivityItem } from "../../components/EmailActivity";
import { EmailEmptyState } from "../../components/EmailEmptyState";
import { EmailButton } from "../../components/EmailButton";
import { EmailDivider } from "../../components/EmailDivider";
import { getSiteUrl } from "@/lib/site-url";

export type WeeklyWorkspaceSummaryProps = {
  workspaceName: string;
  periodLabel: string;
  metrics: Metric[];
  highlights?: ActivityItem[];
  ctaUrl?: string;
  unsubscribeUrl?: string;
};

export function WeeklyWorkspaceSummary({
  workspaceName,
  periodLabel,
  metrics,
  highlights,
  ctaUrl,
  unsubscribeUrl,
}: WeeklyWorkspaceSummaryProps) {
  const url = ctaUrl ?? `${getSiteUrl()}/work-log`;
  const hasActivity = (highlights?.length ?? 0) > 0 || metrics.length > 0;
  return (
    <EmailLayout preview={`Your week in ${workspaceName}`} unsubscribeUrl={unsubscribeUrl}>
      <EmailTitle>Your week in {workspaceName}</EmailTitle>
      <EmailBody>Here&apos;s what your AI workforce accomplished — {periodLabel}.</EmailBody>

      {hasActivity ? (
        <>
          <EmailMetric metrics={metrics} />

          {highlights && highlights.length > 0 ? (
            <>
              <EmailDivider />
              <EmailSection title="Highlights">
                <EmailActivity items={highlights} />
              </EmailSection>
            </>
          ) : null}

          <Section style={{ margin: "12px 0 4px" }}>
            <EmailButton href={url} variant="secondary">
              View full work log
            </EmailButton>
          </Section>
        </>
      ) : (
        <EmailEmptyState
          illustration="chart"
          title="A quiet week"
          description="No activity to report yet. Assign a task to get your workforce moving."
        />
      )}
    </EmailLayout>
  );
}

WeeklyWorkspaceSummary.PreviewProps = {
  workspaceName: "Acme Inc.",
  periodLabel: "Jul 1 – Jul 7",
  metrics: [
    { label: "Tasks completed", value: 24 },
    { label: "Approvals handled", value: 6 },
    { label: "Research runs", value: 9 },
    { label: "Hours worked", value: "41h" },
  ],
  highlights: [
    { actor: "Maya", action: "completed", detail: "Q3 competitor analysis", timestamp: "2 days ago" },
    { actor: "Leo", action: "shipped", detail: "onboarding email draft", timestamp: "yesterday" },
  ],
  ctaUrl: "https://app.adehq.com/work-log",
} as WeeklyWorkspaceSummaryProps;

export default WeeklyWorkspaceSummary;
