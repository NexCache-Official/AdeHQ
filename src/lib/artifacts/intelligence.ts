import type { ArtifactEffect, SavedArtifactType } from "@/lib/types";

export type EmailDraftJson = {
  subject: string;
  to: string | null;
  recipientName: string | null;
  recipientOrganization: string | null;
  body: string;
  signature: string | null;
  placeholders: string[];
  tone: string;
  purpose: string;
  complianceNotes: string[];
  nextSteps: string[];
};

export type ExtractedArtifact = {
  artifactType: SavedArtifactType;
  title: string;
  contentMarkdown: string;
  contentJson: Record<string, unknown>;
  shortReply?: string;
};

const INTRO_PATTERNS = [
  /^sure[,.]?\s/i,
  /^here(?:'s| is)\s/i,
  /^i(?:'ve| have)\s(?:drafted|written|prepared|created)/i,
  /^below is\s/i,
  /^i drafted\s/i,
];

const OUTRO_PATTERNS = [
  /\n+i(?:'ve| have) saved the full draft.*$/is,
  /\n+let me know if you(?:'d| would) like.*$/is,
  /\n+feel free to.*$/is,
  /\n+i can (?:also )?adjust.*$/is,
  /\n+this is a draft.*$/is,
  /\n+connect gmail.*$/is,
];

/** Bracketed refs the model sometimes emits: [msg_…] */
const BRACKETED_MSG_ID_RE = /\s*\[msg_[a-z0-9_-]+\]\s*/gi;
/** Parenthetical citation dumps: (msg_a, msg_b) or (wt_…) */
const PAREN_INTERNAL_IDS_RE =
  /\s*\(\s*(?:(?:msg_|wt_|run_|task_|approval_)[a-z0-9_-]+\s*,\s*)*(?:msg_|wt_|run_|task_|approval_)[a-z0-9_-]+\s*\)\s*/gi;
/** Bare internal ids left in prose */
const BARE_INTERNAL_ID_RE = /\b(?:msg_|wt_|run_|task_|approval_)[a-z0-9_-]+\b/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function stripInternalRefs(text: string): string {
  return text
    .replace(PAREN_INTERNAL_IDS_RE, " ")
    .replace(BRACKETED_MSG_ID_RE, " ")
    .replace(BARE_INTERNAL_ID_RE, " ")
    .replace(UUID_RE, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripCommentary(text: string): string {
  let out = text.trim();
  for (const pattern of INTRO_PATTERNS) {
    out = out.replace(pattern, "");
  }
  for (const pattern of OUTRO_PATTERNS) {
    out = out.replace(pattern, "").trim();
  }
  return out.trim();
}

export function detectDeliverableType(text: string): SavedArtifactType | null {
  const hay = text.toLowerCase();
  if (/\bsubject:\s*.+/i.test(text) && /\b(dear|hi|hello)\b/i.test(text)) return "email_draft";
  if (/\b(prd|product requirements)\b/i.test(hay) && /\b(requirements|user stories|non-goals)\b/i.test(hay))
    return "prd";
  if (/\b(executive summary|key findings|recommendations)\b/i.test(hay)) return "report";
  if (/\b(proposal|deliverables|timeline)\b/i.test(hay) && /\b(approach|situation)\b/i.test(hay))
    return "proposal";
  if (/\b(checklist|action items)\b/i.test(hay) && /^[-*]\s/m.test(text)) return "checklist";
  if (/\b(strategy memo|recommendation memo)\b/i.test(hay)) return "strategy_memo";
  if (/\b(meeting notes|attendees|decisions)\b/i.test(hay)) return "meeting_notes";
  if (/\b(brief|project brief|client brief)\b/i.test(hay)) return "brief";
  if (/\b(launch plan|go-to-market|roadmap)\b/i.test(hay)) return "strategy_memo";
  if (/\|.+\|/m.test(text) && /\|[-\s|]+\|/m.test(text)) return "report";
  return null;
}

const INTENT_PATTERNS: Array<{ pattern: RegExp; type: SavedArtifactType }> = [
  { pattern: /\b(?:draft|write|create|send)\s+(?:a\s+)?(?:cold\s+)?email\b/i, type: "email_draft" },
  { pattern: /\bemail\s+template\b/i, type: "email_draft" },
  { pattern: /\b(?:create|write|generate)\s+(?:a\s+)?prd\b/i, type: "prd" },
  { pattern: /\bturn (?:this )?into (?:a )?prd\b/i, type: "prd" },
  { pattern: /\b(?:create|write|generate)\s+(?:a\s+)?report\b/i, type: "report" },
  { pattern: /\b(?:create|write|generate)\s+(?:a\s+)?(?:client\s+)?proposal\b/i, type: "proposal" },
  { pattern: /\b(?:create|write|generate)\s+(?:a\s+)?brief\b/i, type: "brief" },
  { pattern: /\b(?:create|make)\s+(?:a\s+)?checklist\b/i, type: "checklist" },
  { pattern: /\b(?:create|make)\s+(?:a\s+)?(?:launch|go-to-market|project)\s+plan\b/i, type: "strategy_memo" },
  { pattern: /\bstrategy memo\b/i, type: "strategy_memo" },
  { pattern: /\bmeeting notes\b/i, type: "meeting_notes" },
  { pattern: /\b(?:create|make)\s+(?:a\s+)?template\b/i, type: "note" },
  { pattern: /\b(?:generate|create)\s+(?:a\s+)?pdf\b/i, type: "report" },
  { pattern: /\bturn (?:this )?into (?:a\s+)?(?:doc|document|artifact)\b/i, type: "note" },
  { pattern: /\bcompare options\b/i, type: "report" },
  { pattern: /\bmake (?:a\s+)?table\b/i, type: "report" },
];

export function detectUserArtifactIntent(message: string): SavedArtifactType | null {
  const trimmed = message.trim();
  for (const item of INTENT_PATTERNS) {
    if (item.pattern.test(trimmed)) return item.type;
  }
  return null;
}

function extractSubject(text: string): string | null {
  const match = text.match(/^\s*subject:\s*(.+)$/im);
  return match?.[1]?.trim() ?? null;
}

function extractEmailBody(text: string): string {
  const subjectLine = text.match(/^\s*subject:\s*.+$/im);
  let body = subjectLine ? text.replace(subjectLine[0], "").trim() : text;
  body = stripCommentary(body);
  const dearMatch = body.match(/\b(dear|hi|hello)\b/i);
  if (dearMatch?.index != null) {
    body = body.slice(dearMatch.index).trim();
  }
  return body.trim();
}

function detectRecipient(text: string): { name: string | null; org: string | null } {
  const dear = text.match(/\bdear\s+([^,\n]+)/i)?.[1]?.trim();
  const org =
    text.match(/\b(?:for|to|at)\s+([A-Z][\w\s&'.-]{2,40})/)?.[1]?.trim() ??
    text.match(/\b([A-Z][\w\s&'.-]{2,40})\s+(?:herbals|store|inc|llc|ltd)\b/i)?.[0]?.trim() ??
    null;
  return { name: dear ?? null, org };
}

export function buildEmailDraftJson(text: string, contextHint?: string): EmailDraftJson {
  const cleaned = stripCommentary(text);
  const subject = extractSubject(cleaned) ?? "Email draft";
  const body = extractEmailBody(cleaned);
  const { name, org } = detectRecipient(cleaned);
  const signatureMatch = body.match(/\n(best regards|regards|sincerely)[\s\S]*$/i);
  const signature = signatureMatch?.[0]?.trim() ?? null;
  const mainBody = signature ? body.replace(signature, "").trim() : body;
  const placeholders = [...mainBody.matchAll(/\[[^\]]+\]/g)].map((m) => m[0]);

  return {
    subject,
    to: name,
    recipientName: name,
    recipientOrganization: org,
    body: mainBody,
    signature,
    placeholders,
    tone: "professional",
    purpose: contextHint ?? "outreach",
    complianceNotes: /health|supplement|herbal|medical/i.test(text)
      ? ["Avoid medical or treatment claims unless user provides approved copy."]
      : [],
    nextSteps: [],
  };
}

export function emailMarkdownFromJson(json: EmailDraftJson): string {
  const parts = [`**Subject:** ${json.subject}`];
  if (json.recipientName || json.recipientOrganization) {
    parts.push(
      `**To:** ${[json.recipientName, json.recipientOrganization].filter(Boolean).join(" · ")}`,
    );
  }
  parts.push("", json.body);
  if (json.signature) parts.push("", json.signature);
  return parts.join("\n");
}

export function emailCopyText(json: EmailDraftJson): string {
  return `Subject: ${json.subject}\n\n${json.body}${json.signature ? `\n\n${json.signature}` : ""}`;
}

function titleFromEmail(json: EmailDraftJson, fallback?: string): string {
  if (json.recipientOrganization) {
    const purpose = /pop-?up|vendor|participation|inquiry/i.test(json.subject + json.body)
      ? "pop-up inquiry email"
      : "outreach email";
    return `${json.recipientOrganization} ${purpose}`.slice(0, 80);
  }
  if (json.subject && json.subject.length <= 72) return json.subject;
  return fallback ?? "Email draft";
}

function titleFromContent(type: SavedArtifactType, content: string, hint?: string): string {
  if (hint && hint.length <= 80) return hint;
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 80);
  const first = content.split("\n").find((l) => l.trim() && !/^subject:/i.test(l))?.trim();
  if (first) return first.replace(/^[-*#]+\s*/, "").slice(0, 80);
  switch (type) {
    case "prd":
      return "Product requirements document";
    case "report":
      return "Report";
    case "proposal":
      return "Proposal";
    case "brief":
      return "Project brief";
    case "checklist":
      return "Checklist";
    default:
      return "Artifact from chat";
  }
}

export function extractArtifactFromMessage(
  content: string,
  opts?: { preferredType?: SavedArtifactType | null; titleHint?: string; userRequest?: string },
): ExtractedArtifact | null {
  const preferred = opts?.preferredType ?? detectDeliverableType(content) ?? detectUserArtifactIntent(opts?.userRequest ?? "");
  if (!preferred) return null;

  const stripped = stripCommentary(content);

  if (preferred === "email_draft" || (extractSubject(stripped) && /\bdear\b/i.test(stripped))) {
    const json = buildEmailDraftJson(stripped, opts?.userRequest);
    if (!json.body || json.body.length < 20) return null;
    return {
      artifactType: "email_draft",
      title: titleFromEmail(json, opts?.titleHint),
      contentMarkdown: emailMarkdownFromJson(json),
      contentJson: json as unknown as Record<string, unknown>,
      shortReply: "I drafted a professional email and saved it as an editable draft.",
    };
  }

  const deliverable = stripped;
  if (deliverable.length < 40) return null;

  return {
    artifactType: preferred,
    title: titleFromContent(preferred, deliverable, opts?.titleHint),
    contentMarkdown: deliverable,
    contentJson: {},
    shortReply: `I prepared a ${preferred.replace(/_/g, " ")} and saved it as an artifact you can open, copy, or save to memory.`,
  };
}

export function inferArtifactsFromReply(
  userMessage: string,
  reply: string,
  existingArtifacts: ArtifactEffect[] = [],
  existingEmailDrafts: Array<{ subject: string; body: string }> = [],
): { artifacts: ArtifactEffect[]; emailDrafts: Array<{ subject: string; body: string; recipient?: string; company?: string }>; reply: string } {
  if (existingArtifacts.length || existingEmailDrafts.length) {
    return { artifacts: existingArtifacts, emailDrafts: existingEmailDrafts, reply };
  }

  const intent = detectUserArtifactIntent(userMessage);
  const extracted = extractArtifactFromMessage(reply, { preferredType: intent, userRequest: userMessage });
  if (!extracted) {
    return { artifacts: existingArtifacts, emailDrafts: existingEmailDrafts, reply };
  }

  if (extracted.artifactType === "email_draft") {
    return {
      artifacts: [
        {
          title: extracted.title,
          artifactType: "email_draft",
          contentMarkdown: extracted.contentMarkdown,
          contentJson: extracted.contentJson,
          status: "draft",
        },
      ],
      emailDrafts: [],
      reply: extracted.shortReply ?? reply.split("\n").slice(0, 2).join("\n"),
    };
  }

  return {
    artifacts: [
      {
        title: extracted.title,
        artifactType: extracted.artifactType,
        contentMarkdown: extracted.contentMarkdown,
        contentJson: extracted.contentJson,
        status: "draft",
      },
    ],
    emailDrafts: [],
    reply: extracted.shortReply ?? reply.split("\n").slice(0, 2).join("\n"),
  };
}

export function artifactMemoryDraftFromArtifact(params: {
  title: string;
  artifactType: SavedArtifactType;
  contentMarkdown: string;
  contentJson?: Record<string, unknown>;
}): { title: string; content: string; category: string; tags: string[] } {
  const { title, artifactType, contentMarkdown, contentJson } = params;

  if (artifactType === "email_draft" && contentJson) {
    const json = contentJson as unknown as EmailDraftJson;
    const org = json.recipientOrganization ?? "contact";
    return {
      title: `${org} outreach email draft`.slice(0, 80),
      content: `Drafted a professional inquiry email${json.recipientOrganization ? ` for ${json.recipientOrganization}` : ""}${json.subject ? ` — subject: "${json.subject}"` : ""}.`,
      category: "Sales",
      tags: ["email draft", "outreach", org, ...(json.placeholders?.length ? ["template"] : [])].filter(Boolean).slice(0, 8),
    };
  }

  return {
    title: title.slice(0, 80),
    content: contentMarkdown.slice(0, 500).replace(/^#+\s+/gm, ""),
    category: artifactType === "report" || artifactType === "research_summary" ? "Market Research" : "Decision",
    tags: [artifactType.replace(/_/g, " "), "artifact"],
  };
}
