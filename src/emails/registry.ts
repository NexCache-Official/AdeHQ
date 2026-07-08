import type { ReactElement } from "react";
import type { EmailCategory } from "@/lib/email/preferences";

import { VerifyEmail, type VerifyEmailProps } from "./templates/auth/VerifyEmail";
import { MagicLink, type MagicLinkProps } from "./templates/auth/MagicLink";
import { ResetPassword, type ResetPasswordProps } from "./templates/auth/ResetPassword";
import { ChangeEmail, type ChangeEmailProps } from "./templates/auth/ChangeEmail";
import { Reauthentication, type ReauthenticationProps } from "./templates/auth/Reauthentication";
import { WorkspaceInvite, type WorkspaceInviteProps } from "./templates/auth/WorkspaceInvite";

import { Welcome, type WelcomeProps } from "./templates/product/Welcome";
import { AiEmployeeHired, type AiEmployeeHiredProps } from "./templates/product/AiEmployeeHired";
import { WeeklyWorkspaceSummary, type WeeklyWorkspaceSummaryProps } from "./templates/product/WeeklyWorkspaceSummary";
import { AiWorkHoursLow, type AiWorkHoursLowProps } from "./templates/product/AiWorkHoursLow";

import { NewLogin, type NewLoginProps } from "./templates/security/NewLogin";
import { PasswordChanged, type PasswordChangedProps } from "./templates/security/PasswordChanged";

import { BrowserResearchFinished, type BrowserResearchFinishedProps } from "./templates/notification/BrowserResearchFinished";
import { ApprovalRequired, type ApprovalRequiredProps } from "./templates/notification/ApprovalRequired";

import { PaymentSucceeded, type PaymentSucceededProps } from "./templates/billing/PaymentSucceeded";
import { PaymentFailed, type PaymentFailedProps } from "./templates/billing/PaymentFailed";
import { TrialEnding, type TrialEndingProps } from "./templates/billing/TrialEnding";

export type TemplateDefinition<P> = {
  category: EmailCategory;
  subject: (props: P) => string;
  Component: (props: P) => ReactElement;
};

function define<P>(def: TemplateDefinition<P>): TemplateDefinition<P> {
  return def;
}

/**
 * Single source of truth for every email. Add a new template here — the key,
 * its category (drives preference gating), the subject builder, and the
 * component. `sendEmail` and the auth hook route look templates up by key.
 */
export const EMAIL_REGISTRY = {
  // --- Auth (delivered via the Supabase Send Email hook) ---
  verify_email: define<VerifyEmailProps>({
    category: "auth",
    subject: () => "Confirm your email for AdeHQ",
    Component: VerifyEmail,
  }),
  magic_link: define<MagicLinkProps>({
    category: "auth",
    subject: () => "Your AdeHQ sign-in link",
    Component: MagicLink,
  }),
  reset_password: define<ResetPasswordProps>({
    category: "auth",
    subject: () => "Reset your AdeHQ password",
    Component: ResetPassword,
  }),
  change_email: define<ChangeEmailProps>({
    category: "auth",
    subject: () => "Confirm your new email for AdeHQ",
    Component: ChangeEmail,
  }),
  reauthentication: define<ReauthenticationProps>({
    category: "auth",
    subject: () => "Your AdeHQ verification code",
    Component: Reauthentication,
  }),
  workspace_invite: define<WorkspaceInviteProps>({
    category: "auth",
    subject: (p) => `You're invited to ${p.workspaceName} on AdeHQ`,
    Component: WorkspaceInvite,
  }),

  // --- Product (preference-gated: product_updates / weekly_reports) ---
  welcome: define<WelcomeProps>({
    category: "product_updates",
    subject: () => "Welcome to AdeHQ 🎉",
    Component: Welcome,
  }),
  ai_employee_hired: define<AiEmployeeHiredProps>({
    category: "product_updates",
    subject: (p) => `${p.employeeName} has joined ${p.workspaceName}`,
    Component: AiEmployeeHired,
  }),
  weekly_workspace_summary: define<WeeklyWorkspaceSummaryProps>({
    category: "weekly_reports",
    subject: (p) => `Your week in ${p.workspaceName}`,
    Component: WeeklyWorkspaceSummary,
  }),
  ai_work_hours_low: define<AiWorkHoursLowProps>({
    category: "weekly_reports",
    subject: (p) => `AI work hours running low in ${p.workspaceName}`,
    Component: AiWorkHoursLow,
  }),

  // --- Security (always-on) ---
  new_login: define<NewLoginProps>({
    category: "security",
    subject: () => "New sign-in to your AdeHQ account",
    Component: NewLogin,
  }),
  password_changed: define<PasswordChangedProps>({
    category: "security",
    subject: () => "Your AdeHQ password was changed",
    Component: PasswordChanged,
  }),

  // --- Notification (preference-gated: activity_notifications) ---
  browser_research_finished: define<BrowserResearchFinishedProps>({
    category: "activity_notifications",
    subject: (p) => `Research ready: ${p.title}`,
    Component: BrowserResearchFinished,
  }),
  approval_required: define<ApprovalRequiredProps>({
    category: "activity_notifications",
    subject: (p) => `Approval needed: ${p.actionTitle}`,
    Component: ApprovalRequired,
  }),

  // --- Billing (always-on; render-ready, not yet wired) ---
  payment_succeeded: define<PaymentSucceededProps>({
    category: "billing",
    subject: () => "Payment received — thank you",
    Component: PaymentSucceeded,
  }),
  payment_failed: define<PaymentFailedProps>({
    category: "billing",
    subject: () => "Action needed: your AdeHQ payment failed",
    Component: PaymentFailed,
  }),
  trial_ending: define<TrialEndingProps>({
    category: "billing",
    subject: (p) => `Your AdeHQ trial ends in ${p.daysLeft} days`,
    Component: TrialEnding,
  }),
} as const;

export type TemplateKey = keyof typeof EMAIL_REGISTRY;

export type TemplateProps<K extends TemplateKey> =
  (typeof EMAIL_REGISTRY)[K] extends TemplateDefinition<infer P> ? P : never;

export function getTemplate<K extends TemplateKey>(key: K): (typeof EMAIL_REGISTRY)[K] {
  return EMAIL_REGISTRY[key];
}
