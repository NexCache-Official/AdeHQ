import * as React from "react";
import { Img, Section } from "@react-email/components";
import { illustrationUrl, type IllustrationName } from "../assets";

const ALT: Record<IllustrationName, string> = {
  robot: "AI employee",
  sparkles: "Sparkles",
  workspace: "Workspace",
  shield: "Security shield",
  lock: "Lock",
  envelope: "Envelope",
  chart: "Chart",
  rocket: "Rocket",
  celebration: "Celebration",
  search: "Search",
  browser: "Browser window",
  folder: "Folder",
  empty: "Nothing here yet",
};

/**
 * Thin wrapper around a hosted illustration PNG (Gmail-safe). Centered by
 * default; size is width in px (illustrations are square).
 */
export function Illustration({
  name,
  size = 72,
  align = "center",
}: {
  name: IllustrationName;
  size?: number;
  align?: "left" | "center";
}) {
  return (
    <Section style={{ textAlign: align, marginBottom: "8px" }}>
      <Img
        src={illustrationUrl(name)}
        width={String(size)}
        height={String(size)}
        alt={ALT[name]}
        style={{ display: "inline-block" }}
      />
    </Section>
  );
}

export default Illustration;
