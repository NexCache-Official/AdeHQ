"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LIVE_BRAIN_CALLS_ENABLED } from "@/lib/config/features";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Phone } from "lucide-react";

type WorkforceCallButtonProps = {
  roomId?: string;
  size?: "sm" | "md" | "lg" | "icon";
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
  className?: string;
  showLabel?: boolean;
  iconOnly?: boolean;
};

/** Routes to live calls when enabled; otherwise opens the coming-soon page. */
export function WorkforceCallButton({
  roomId,
  size = "sm",
  variant = "secondary",
  className,
  showLabel = true,
  iconOnly = false,
}: WorkforceCallButtonProps) {
  const router = useRouter();
  const href = LIVE_BRAIN_CALLS_ENABLED
    ? roomId
      ? `/calls?room=${roomId}`
      : "/calls"
    : "/calls";

  if (iconOnly) {
    return (
      <Link
        href={href}
        className={cn(
          "flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-border bg-surface text-ink-2 transition-colors hover:bg-muted",
          className,
        )}
        aria-label={LIVE_BRAIN_CALLS_ENABLED ? "Start call" : "Brain calls — coming soon"}
        title={LIVE_BRAIN_CALLS_ENABLED ? "Start call" : "Brain calls — coming soon"}
      >
        <Phone className="h-[15px] w-[15px]" strokeWidth={1.9} />
      </Link>
    );
  }

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={() => router.push(href)}
      title={LIVE_BRAIN_CALLS_ENABLED ? undefined : "Brain calls — coming soon"}
    >
      <Phone className="h-4 w-4" />
      {showLabel && (LIVE_BRAIN_CALLS_ENABLED ? "Call" : "Call — soon")}
    </Button>
  );
}
