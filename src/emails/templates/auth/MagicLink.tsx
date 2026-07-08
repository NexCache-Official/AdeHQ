import * as React from "react";
import { MinimalAuthEmail } from "./MinimalAuthEmail";

export type MagicLinkProps = {
  actionUrl: string;
  expiresInMinutes?: number;
};

export function MagicLink({ actionUrl, expiresInMinutes = 20 }: MagicLinkProps) {
  return (
    <MinimalAuthEmail
      preview="Your AdeHQ sign-in link"
      title="Sign in to AdeHQ"
      intro="Click the button below to securely sign in to your AdeHQ account. No password needed."
      actionLabel="Sign in to AdeHQ"
      actionUrl={actionUrl}
      expiresInMinutes={expiresInMinutes}
      securityNote="If you didn't try to sign in, you can safely ignore this email — your account stays secure."
    />
  );
}

MagicLink.PreviewProps = {
  actionUrl: "https://app.adehq.com/auth/callback?token=preview",
  expiresInMinutes: 20,
} as MagicLinkProps;

export default MagicLink;
