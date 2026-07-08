import * as React from "react";
import { MinimalAuthEmail } from "./MinimalAuthEmail";

export type ChangeEmailProps = {
  actionUrl: string;
  newEmail?: string;
  expiresInMinutes?: number;
};

export function ChangeEmail({ actionUrl, newEmail, expiresInMinutes = 60 }: ChangeEmailProps) {
  return (
    <MinimalAuthEmail
      preview="Confirm your new email address for AdeHQ"
      title="Confirm your new email"
      intro={
        newEmail
          ? `Confirm that you want to use ${newEmail} as your AdeHQ email address.`
          : "Confirm the change to your AdeHQ email address."
      }
      actionLabel="Confirm email change"
      actionUrl={actionUrl}
      expiresInMinutes={expiresInMinutes}
      securityNote="If you didn't request this change, please secure your account by resetting your password."
    />
  );
}

ChangeEmail.PreviewProps = {
  actionUrl: "https://app.adehq.com/auth/callback?token=preview",
  newEmail: "new@example.com",
  expiresInMinutes: 60,
} as ChangeEmailProps;

export default ChangeEmail;
