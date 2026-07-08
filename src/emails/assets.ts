import { getSiteUrl } from "@/lib/site-url";

/** Absolute URL to a hosted email asset (Gmail-safe PNGs live in public/email). */
export function emailAsset(file: string): string {
  return `${getSiteUrl()}/email/${file}`;
}

export const brandAssets = {
  icon: () => emailAsset("adehq-icon.png"),
  lockup: () => emailAsset("adehq-lockup.png"),
};

/** Illustration keys map 1:1 to public/email/illustration-<key>.png. */
export type IllustrationName =
  | "robot"
  | "sparkles"
  | "workspace"
  | "shield"
  | "lock"
  | "envelope"
  | "chart"
  | "rocket"
  | "celebration"
  | "search"
  | "browser"
  | "folder"
  | "empty";

export function illustrationUrl(name: IllustrationName): string {
  return emailAsset(`illustration-${name}.png`);
}
