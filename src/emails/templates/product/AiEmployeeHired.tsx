import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailButton } from "../../components/EmailButton";
import { EmailEmployee } from "../../components/EmailEmployee";
import { Illustration } from "../../illustrations/Illustration";
import { getSiteUrl } from "@/lib/site-url";

export type AiEmployeeHiredProps = {
  employeeName: string;
  role: string;
  workspaceName: string;
  avatarUrl?: string;
  ctaUrl?: string;
  unsubscribeUrl?: string;
};

export function AiEmployeeHired({
  employeeName,
  role,
  workspaceName,
  avatarUrl,
  ctaUrl,
  unsubscribeUrl,
}: AiEmployeeHiredProps) {
  const url = ctaUrl ?? `${getSiteUrl()}/workforce`;
  return (
    <EmailLayout preview={`${employeeName} joined ${workspaceName}`} unsubscribeUrl={unsubscribeUrl}>
      <Illustration name="robot" size={84} />
      <EmailTitle>{employeeName} is on the team</EmailTitle>
      <EmailBody>
        Your new AI employee just joined <strong>{workspaceName}</strong> and is ready to work. Give
        them their first task or assign them to a project room.
      </EmailBody>

      <Section style={{ marginTop: "8px", marginBottom: "16px" }}>
        <EmailEmployee name={employeeName} role={role} avatarSrc={avatarUrl} status="Active" />
      </Section>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={url}>Assign first task</EmailButton>
      </Section>
    </EmailLayout>
  );
}

AiEmployeeHired.PreviewProps = {
  employeeName: "Maya",
  role: "Research Analyst",
  workspaceName: "Acme Inc.",
  ctaUrl: "https://app.adehq.com/workforce",
} as AiEmployeeHiredProps;

export default AiEmployeeHired;
