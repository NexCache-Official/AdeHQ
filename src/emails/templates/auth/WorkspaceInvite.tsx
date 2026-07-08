import * as React from "react";
import { Section, Text } from "@react-email/components";
import { EmailLayout } from "../../layouts/EmailLayout";
import { EmailButton } from "../../components/EmailButton";
import { EmailTitle, EmailBody } from "../../components/EmailText";
import { EmailWorkspace } from "../../components/EmailWorkspace";
import { EmailBadge } from "../../components/EmailBadge";
import { colors, fontSize } from "../../theme";

export type WorkspaceInviteProps = {
  actionUrl: string;
  workspaceName: string;
  inviterName?: string;
  role: string;
};

export function WorkspaceInvite({
  actionUrl,
  workspaceName,
  inviterName,
  role,
}: WorkspaceInviteProps) {
  return (
    <EmailLayout preview={`You've been invited to join ${workspaceName} on AdeHQ`}>
      <EmailTitle>You&apos;re invited to {workspaceName}</EmailTitle>
      <EmailBody>
        {inviterName ? (
          <>
            <strong>{inviterName}</strong> invited you to collaborate in their AdeHQ workspace.
          </>
        ) : (
          <>You&apos;ve been invited to collaborate in an AdeHQ workspace.</>
        )}{" "}
        Join to work alongside their AI employees in shared project rooms.
      </EmailBody>

      <Section style={{ marginTop: "8px", marginBottom: "16px" }}>
        <EmailWorkspace name={workspaceName} subtitle="AdeHQ workspace" />
      </Section>

      <Section style={{ marginBottom: "16px" }}>
        <Text style={{ margin: 0, fontSize: fontSize.sm, color: colors.muted }}>
          Your role: <EmailBadge tone="accent">{role}</EmailBadge>
        </Text>
      </Section>

      <Section style={{ margin: "4px 0" }}>
        <EmailButton href={actionUrl}>Join workspace</EmailButton>
      </Section>

      <Text style={{ margin: "20px 0 0", fontSize: fontSize.sm, color: colors.muted, lineHeight: "20px" }}>
        If you weren&apos;t expecting this invitation, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
}

WorkspaceInvite.PreviewProps = {
  actionUrl: "https://app.adehq.com/login?next=/onboarding",
  workspaceName: "Acme Inc.",
  inviterName: "Jordan Lee",
  role: "member",
} as WorkspaceInviteProps;

export default WorkspaceInvite;
