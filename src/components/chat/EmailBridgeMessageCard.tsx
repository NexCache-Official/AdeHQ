"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import {
  parseEmailBridgeForDisplay,
  sanitizeEmailBridgeForDisplay,
} from "@/lib/inbox/email-bridge-display";
import { MessageMarkdown } from "@/components/MessageMarkdown";

type Props = {
  content: string;
  compact?: boolean;
};

export function EmailBridgeMessageCard({ content, compact }: Props) {
  const parsed = parseEmailBridgeForDisplay(content);
  if (!parsed) {
    return (
      <MessageMarkdown content={sanitizeEmailBridgeForDisplay(content)} compact={compact} roomScale />
    );
  }

  return (
    <div className="max-w-xl rounded-xl border border-border bg-muted/60 px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-ink-2">
        <Mail className="h-3.5 w-3.5 text-accent" />
        Inbox thread
      </div>
      {parsed.subject ? (
        <p className="text-[14px] font-medium text-ink">{parsed.subject}</p>
      ) : null}
      {parsed.participants ? (
        <p className="mt-0.5 text-[12px] text-ink-3">With {parsed.participants}</p>
      ) : null}
      {parsed.summary ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{parsed.summary}</p>
      ) : null}
      {parsed.keyPoints.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-ink-2">
          {parsed.keyPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      {parsed.excerpt ? (
        <p className="mt-2 border-l-2 border-border pl-2.5 text-[12.5px] italic leading-relaxed text-ink-3">
          {parsed.excerpt}
        </p>
      ) : null}
      {parsed.inboxDeepLink ? (
        <Link
          href={parsed.inboxDeepLink}
          className="mt-2.5 inline-flex text-[12px] font-medium text-accent hover:text-accent-d"
        >
          Open in Inbox
        </Link>
      ) : null}
      {parsed.notice ? (
        <p className="mt-2.5 text-[13px] leading-relaxed text-ink">{parsed.notice}</p>
      ) : null}
    </div>
  );
}
