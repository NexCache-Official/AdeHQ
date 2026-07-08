/**
 * AdeHQ email design tokens — light theme only.
 *
 * Emails are hard-coded to a light palette (see the brief): the brand icon is a
 * light-mode asset and the platform is dropping dark mode, so there is no dark
 * `@media` block anywhere in the email system. Colors are literal hex so that
 * email clients (which ignore CSS variables) render them faithfully.
 */

export const colors = {
  // Brand / accent
  accent: "#2563EB",
  accentDark: "#1D4ED8",
  accentSoft: "#EFF4FF",
  accentBorder: "#DBE4FF",

  // Surfaces
  background: "#F8FAFC",
  card: "#FFFFFF",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",

  // Text
  heading: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  faint: "#94A3B8",
  onAccent: "#FFFFFF",

  // Status
  success: "#16A34A",
  successSoft: "#F0FDF4",
  successBorder: "#BBF7D0",
  warning: "#D97706",
  warningSoft: "#FFFBEB",
  warningBorder: "#FDE68A",
  error: "#DC2626",
  errorSoft: "#FEF2F2",
  errorBorder: "#FECACA",
  info: "#2563EB",
  infoSoft: "#EFF4FF",
  infoBorder: "#DBE4FF",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  xxl: "48px",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  full: "999px",
} as const;

export const fonts = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

export const fontSize = {
  xs: "12px",
  sm: "13px",
  base: "15px",
  md: "16px",
  lg: "18px",
  xl: "22px",
  xxl: "28px",
} as const;

export const layout = {
  maxWidth: "600px",
  contentPadding: "32px",
} as const;

/** Default sender when EMAIL_FROM is unset (override in Vercel / .env.local). */
export const DEFAULT_EMAIL_FROM = "AdeHQ <noreply@adehq.com>";
/** Default reply-to for human responses when EMAIL_REPLY_TO is unset. */
export const DEFAULT_EMAIL_REPLY_TO = "AdeHQ <hello@adehq.com>";

/** From identity + reply-to, resolved from env with sane defaults. */
export const EMAIL_FROM = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
export const EMAIL_REPLY_TO =
  process.env.EMAIL_REPLY_TO?.trim() || DEFAULT_EMAIL_REPLY_TO;

export const theme = { colors, spacing, radius, fonts, fontSize, layout } as const;
export type EmailTheme = typeof theme;
