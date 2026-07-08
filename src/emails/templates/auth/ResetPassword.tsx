import * as React from "react";
import { MinimalAuthEmail } from "./MinimalAuthEmail";

export type ResetPasswordProps = {
  actionUrl: string;
  expiresInMinutes?: number;
};

export function ResetPassword({ actionUrl, expiresInMinutes = 60 }: ResetPasswordProps) {
  return (
    <MinimalAuthEmail
      preview="Reset your AdeHQ password"
      title="Reset your password"
      intro="We received a request to reset your AdeHQ password. Click below to choose a new one."
      actionLabel="Reset password"
      actionUrl={actionUrl}
      expiresInMinutes={expiresInMinutes}
      securityNote="If you didn't request a password reset, ignore this email and your password will stay unchanged."
    />
  );
}

ResetPassword.PreviewProps = {
  actionUrl: "https://app.adehq.com/auth/callback?token=preview",
  expiresInMinutes: 60,
} as ResetPasswordProps;

export default ResetPassword;
