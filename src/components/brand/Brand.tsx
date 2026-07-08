import { cn } from "@/lib/utils";

/**
 * Central AdeHQ brand components. Source SVGs live in public/brand.
 *
 * - BrandMark: the icon only. Tinted via `currentColor` using a CSS mask, so it
 *   inherits text color (e.g. `text-accent`) and can be recolored anywhere.
 * - BrandWordmark: the "AdeHQ" text logo (fixed brand colors).
 * - BrandLockup: icon + wordmark, or icon-only, at a chosen size.
 */

const ICON_URL = "/brand/adehq-icon.svg";
const WORDMARK_URL = "/brand/adehq-wordmark.svg";

// Icon source viewBox is 640x622 (very slightly taller than wide).
const ICON_RATIO = 640 / 622;

export function BrandMark({
  size = 24,
  className,
  title = "AdeHQ",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const width = Math.round(size * ICON_RATIO);
  return (
    <span
      role="img"
      aria-label={title}
      className={cn("inline-block shrink-0", className)}
      style={{
        width,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: `url(${ICON_URL})`,
        maskImage: `url(${ICON_URL})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

export function BrandWordmark({
  height = 20,
  className,
}: {
  height?: number;
  className?: string;
}) {
  // Wordmark source viewBox is 1352x494.
  const width = Math.round(height * (1352 / 494));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={WORDMARK_URL}
      alt="AdeHQ"
      width={width}
      height={height}
      className={cn("inline-block shrink-0", className)}
      style={{ height, width: "auto" }}
    />
  );
}

export function BrandLockup({
  variant = "lockup",
  size = 28,
  className,
  markClassName,
}: {
  variant?: "lockup" | "icon";
  /** Icon height in px; wordmark scales to match. */
  size?: number;
  className?: string;
  markClassName?: string;
}) {
  if (variant === "icon") {
    return <BrandMark size={size} className={cn("text-accent", markClassName)} />;
  }
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={size} className={cn("text-accent", markClassName)} />
      <BrandWordmark height={Math.round(size * 0.72)} />
    </span>
  );
}
