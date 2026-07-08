import * as React from "react";
import { MinimalAuthEmail } from "./MinimalAuthEmail";

export type VerifyEmailProps = {
  actionUrl: string;
  expiresInMinutes?: number;
};

export function VerifyEmail({ actionUrl, expiresInMinutes = 20 }: VerifyEmailProps) {
  return (
    <MinimalAuthEmail
      preview="Confirm your email to activate your AdeHQ account"
      title="Confirm your email"
      intro="Welcome to AdeHQ. Confirm your email address to activate your account and set up your AI workforce."
      actionLabel="Confirm email address"
      actionUrl={actionUrl}
      expiresInMinutes={expiresInMinutes}
      securityNote="If you didn't create an AdeHQ account, you can safely ignore this email."
    />
  );
}

VerifyEmail.PreviewProps = {
  actionUrl: "https://app.adehq.com/auth/callback?token=preview",
  expiresInMinutes: 20,
} as VerifyEmailProps;

export default VerifyEmail;
