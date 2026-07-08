import * as React from "react";
import { Section } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailButton } from "../../components/EmailButton";
import { EmailSignature } from "../../components/EmailSignature";
import { Illustration } from "../../illustrations/Illustration";
import { getSiteUrl } from "@/lib/site-url";

export type WelcomeProps = {
  firstName?: string;
  ctaUrl?: string;
  unsubscribeUrl?: string;
};

export function Welcome({ firstName, ctaUrl, unsubscribeUrl }: WelcomeProps) {
  const url = ctaUrl ?? `${getSiteUrl()}/`;
  return (
    <EmailLayout preview="Welcome to AdeHQ — let's build your AI workforce" unsubscribeUrl={unsubscribeUrl}>
      <Illustration name="rocket" size={84} />
      <EmailTitle>{firstName ? `Welcome, ${firstName}` : "Welcome to AdeHQ"}</EmailTitle>
      <EmailBody>
        Your AI headquarters is ready. Hire AI employees, give them real tools, and work with them
        in project rooms — they remember decisions and ask for approval before risky actions.
      </EmailBody>
      <EmailBody>Here&apos;s the fastest way to get value in your first five minutes:</EmailBody>
      <EmailBody style={{ margin: "0 0 6px" }}>1. Hire your first AI employee and pick a role.</EmailBody>
      <EmailBody style={{ margin: "0 0 6px" }}>2. Connect a tool so they can take real action.</EmailBody>
      <EmailBody>3. Open a project room and give them their first task.</EmailBody>

      <Section style={{ margin: "8px 0 4px" }}>
        <EmailButton href={url}>Open your workspace</EmailButton>
      </Section>

      <EmailSignature />
    </EmailLayout>
  );
}

Welcome.PreviewProps = {
  firstName: "Sam",
  ctaUrl: "https://app.adehq.com/",
} as WelcomeProps;

export default Welcome;
