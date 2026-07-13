/**
 * Deterministic email triage — no LLM. Produces keyPoints signals only.
 */

import type { EmailTriageResult, EmailCategory, EmailPriority } from "./types";

export type TriageMessageInput = {
  fromAddress: string | null;
  fromName: string | null;
  to: string[];
  subject: string;
  textBody: string | null;
  htmlSanitised: string | null;
  securityFlags: string[];
  hasAttachments: boolean;
  headers?: Record<string, string>;
};

const NEWSLETTER_RE =
  /\b(unsubscribe|view in browser|email preferences|newsletter|weekly digest)\b/i;
const RECEIPT_RE =
  /\b(receipt|invoice|order confirmation|payment received|your order|shipping confirmation)\b/i;
const BOUNCE_RE =
  /\b(mail delivery failed|undeliverable|delivery status notification|returned mail|failure notice)\b/i;
const NOTIFICATION_RE =
  /\b(notification|alert|no-?reply|donotreply|do-not-reply)\b/i;
const SUPPORT_RE =
  /\b(support|help desk|ticket|bug|issue|broken|not working|error)\b/i;
const SALES_RE =
  /\b(pricing|quote|demo|proposal|interested in|buy|purchase|enterprise|trial)\b/i;
const BILLING_RE = /\b(billing|invoice overdue|refund|subscription|charge)\b/i;
const PARTNERSHIP_RE = /\b(partnership|collaborate|co-?market|affiliate)\b/i;
const INVESTOR_RE = /\b(investor|term sheet|fundraising|cap table|due diligence)\b/i;
const RECRUITING_RE = /\b(job application|resume|cv\b|hiring|interview|candidate)\b/i;
const REPLY_RE =
  /\b(please (reply|respond|confirm|let me know)|looking forward to hearing|awaiting your|need your|can you|could you|would you)\b/i;
const URGENT_RE = /\b(urgent|asap|immediately|critical|emergency|today)\b/i;
const DEADLINE_RE =
  /\b(by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|by \d{1,2}[\/\-]|deadline|eod|end of (day|week))\b/i;
const AUTO_FROM_RE =
  /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster)@/i;

function plainText(input: TriageMessageInput): string {
  const raw =
    input.textBody ||
    (input.htmlSanitised ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return raw.slice(0, 12_000);
}

export function triageWithRules(input: TriageMessageInput): EmailTriageResult {
  const subject = input.subject || "";
  const body = plainText(input);
  const blob = `${subject}\n${body}\n${input.fromAddress ?? ""}`;
  const from = (input.fromAddress ?? "").toLowerCase();
  const keyPoints: string[] = [];
  const safetyFlags = [...(input.securityFlags ?? [])];

  let category: EmailCategory = "general";
  let priority: EmailPriority = "normal";
  let replyRequired = false;
  let automationType: EmailTriageResult["automationType"];
  let confidence = 0.55;

  if (BOUNCE_RE.test(blob) || from.startsWith("mailer-daemon@") || from.startsWith("postmaster@")) {
    category = "automated";
    automationType = "bounce";
    priority = "high";
    replyRequired = false;
    confidence = 0.95;
    keyPoints.push("Bounce / delivery failure notice");
  } else if (NEWSLETTER_RE.test(blob) || /list-unsubscribe/i.test(JSON.stringify(input.headers ?? {}))) {
    category = "newsletter";
    automationType = "newsletter";
    priority = "low";
    replyRequired = false;
    confidence = 0.9;
    keyPoints.push("Looks like a newsletter or marketing mail");
  } else if (RECEIPT_RE.test(blob)) {
    category = "automated";
    automationType = "receipt";
    priority = "low";
    replyRequired = false;
    confidence = 0.85;
    keyPoints.push("Receipt or order confirmation");
  } else if (AUTO_FROM_RE.test(from) || NOTIFICATION_RE.test(blob)) {
    category = "automated";
    automationType = "notification";
    priority = "low";
    replyRequired = false;
    confidence = 0.8;
    keyPoints.push("Automated notification");
  } else if (INVESTOR_RE.test(blob)) {
    category = "investor";
    confidence = 0.75;
    keyPoints.push("Likely investor-related");
  } else if (PARTNERSHIP_RE.test(blob)) {
    category = "partnership";
    confidence = 0.7;
    keyPoints.push("Likely partnership enquiry");
  } else if (RECRUITING_RE.test(blob)) {
    category = "recruiting";
    confidence = 0.7;
    keyPoints.push("Likely recruiting / application");
  } else if (BILLING_RE.test(blob)) {
    category = "billing";
    confidence = 0.75;
    keyPoints.push("Likely billing-related");
  } else if (SUPPORT_RE.test(blob)) {
    category = "support";
    confidence = 0.75;
    keyPoints.push("Likely support request");
  } else if (SALES_RE.test(blob)) {
    category = "sales";
    confidence = 0.75;
    keyPoints.push("Likely sales enquiry");
  }

  if (safetyFlags.length > 0 || /\b(password|wire transfer|gift card|urgent payment)\b/i.test(blob)) {
    if (/\b(password|wire transfer|gift card|urgent payment)\b/i.test(blob)) {
      safetyFlags.push("suspicious_content");
      category = category === "general" ? "security" : category;
      priority = "urgent";
      keyPoints.push("Security-sensitive language detected");
      confidence = Math.max(confidence, 0.7);
    }
  }

  const isCustomerish =
    !automationType ||
    (automationType !== "newsletter" &&
      automationType !== "bounce" &&
      automationType !== "receipt" &&
      automationType !== "notification");

  if (isCustomerish && (REPLY_RE.test(blob) || /\?/.test(subject))) {
    replyRequired = true;
    keyPoints.push("Reply appears required");
    confidence = Math.max(confidence, 0.65);
  }

  if (URGENT_RE.test(blob)) {
    priority = priority === "low" ? "normal" : "urgent";
    keyPoints.push("Urgency language detected");
  }

  if (DEADLINE_RE.test(blob)) {
    keyPoints.push("Deadline detected");
    if (priority === "normal") priority = "high";
  }

  if (input.hasAttachments) {
    keyPoints.push("Attachment included");
  }

  if (from) {
    keyPoints.push(`From ${from}`);
  }

  let suggestedNextAction: string | undefined;
  if (automationType === "bounce") {
    suggestedNextAction = "Check delivery status on the original outbound message";
  } else if (automationType === "newsletter" || automationType === "receipt") {
    suggestedNextAction = undefined;
  } else if (replyRequired) {
    suggestedNextAction = "Draft a reply when ready";
  }

  // No summary — rules path never invents executive prose.
  return {
    category,
    priority,
    replyRequired,
    confidence,
    assignmentConfidence: 0,
    keyPoints: keyPoints.slice(0, 8),
    suggestedNextAction,
    automationType,
    safetyFlags: [...new Set(safetyFlags)],
    source: "rules",
  };
}
