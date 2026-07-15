import type { ToolCallEffect } from "@/lib/integrations/types";
import { messageWantsEmailSend } from "@/lib/ai/message-intent";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function wantsEmailDraftOrSend(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (messageWantsEmailSend(text)) return true;
  return (
    /\b(?:draft|write|compose)\b/i.test(text) &&
    /\b(?:e?-?mails?|mails?|outreach)\b/i.test(text)
  );
}

function recipientNameFromMessage(message: string, email: string | null): string | undefined {
  const asking = message.match(
    /\basking\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})\b/,
  );
  if (asking?.[1]) return asking[1].trim();
  const toName = message.match(
    /\b(?:to|for)\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})\b/,
  );
  if (toName?.[1] && !toName[1].includes("@")) return toName[1].trim();
  if (email) {
    const local = email.split("@")[0] ?? "";
    const guess = local.split(/[._-]/)[0];
    if (guess && guess.length > 1) {
      return guess.charAt(0).toUpperCase() + guess.slice(1).toLowerCase();
    }
  }
  return undefined;
}

function subjectAndBody(message: string, recipientName?: string): { subject: string; body: string } {
  const name = recipientName ?? "there";
  const checkup =
    /\b(?:how\s+(?:he|she|they|'?s|is)|check[- ]?up|doing|life)\b/i.test(message);
  if (checkup) {
    return {
      subject: "Quick check-in",
      body: `Hi ${name},\n\nJust wanted to check in and see how you're doing — hope life's treating you well.\n\nBest,`,
    };
  }
  return {
    subject: "Quick note",
    body: `Hi ${name},\n\nI wanted to reach out with a quick note.\n\nBest,`,
  };
}

/**
 * Last-resort synthesis when the model narrates an email action (or refuses)
 * without emitting email.createDraft / email.sendDraft. Manager auto-appends
 * sendDraft approval when the source message is a send ask.
 */
export function inferRequiredEmailToolCalls(message: string): ToolCallEffect[] {
  const text = message.trim();
  if (!wantsEmailDraftOrSend(text)) return [];

  const emailMatch = text.match(EMAIL_RE);
  const recipientEmail = emailMatch?.[0]?.toLowerCase() ?? undefined;
  const recipientName = recipientNameFromMessage(text, recipientEmail ?? null);
  const { subject, body } = subjectAndBody(text, recipientName);

  return [
    {
      tool: "email.createDraft",
      mode: "execute",
      args: {
        subject,
        body,
        ...(recipientEmail ? { recipientEmail } : {}),
        ...(recipientName ? { recipientName } : {}),
      },
    },
  ];
}

export function replyForInferredEmailTools(): string {
  return "Drafting that email now — I'll put it up for your approval before anything sends.";
}
