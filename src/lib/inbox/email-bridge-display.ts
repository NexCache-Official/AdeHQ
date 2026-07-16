/**
 * User-facing helpers for Email bridge messages.
 * Stored bridge text historically included AI prompt instructions — strip those
 * for chat UI and render a clean card instead.
 */

export type EmailBridgeDisplay = {
  subject?: string;
  participants?: string;
  summary?: string;
  keyPoints: string[];
  excerpt?: string;
  inboxDeepLink?: string;
  /** Short human line after the bridge (e.g. "@Casey — new reply…"). */
  notice?: string;
};

const AI_INSTRUCTION_LINE =
  /^(this block\b|do not claim\b|do not send\b|human teammates can open\b|never claim\b|never send\b|treat calendar\b|if multiple specialties\b|ask at most\b|identify who replied\b|recommend a concrete\b|briefly tell the human\b|ask only the\b|peers:\b|goal:\b|brainstorm\b|this may need\b|if this is straightforward\b|_snapshot:)/i;

export function isEmailBridgeMessageContent(content: string): boolean {
  return /\*\*Email bridge\*\*/i.test(content) || /^Email bridge\b/im.test(content.trim());
}

export function isEmailBridgeClientMessageId(clientMessageId?: string | null): boolean {
  if (!clientMessageId) return false;
  return /^(email-bridge-|email-wake-|email-ask-|email-brainstorm-)/i.test(clientMessageId);
}

/** Strip AI-only instruction lines from a stored bridge message. */
export function sanitizeEmailBridgeForDisplay(content: string): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (AI_INSTRUCTION_LINE.test(trimmed)) continue;
    if (/^[-*]\s*(Do not |Never |Ask |Recommend |Contribute |Peers:|Goal:)/i.test(trimmed)) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseEmailBridgeForDisplay(content: string): EmailBridgeDisplay | null {
  if (!isEmailBridgeMessageContent(content)) return null;
  const cleaned = sanitizeEmailBridgeForDisplay(content);
  const subject = cleaned.match(/\*\*Subject:\*\*\s*(.+)/i)?.[1]?.trim();
  const participants = cleaned.match(/\*\*Participants:\*\*\s*(.+)/i)?.[1]?.trim();
  const summary = cleaned.match(/\*\*Summary:\*\*\s*(.+)/i)?.[1]?.trim();
  const inboxDeepLink = cleaned.match(/\/inbox\?thread=[^\s)]+/i)?.[0]?.trim();

  const keyPoints: string[] = [];
  const keyBlock = cleaned.match(/\*\*Key points:\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n>|\n@|\nHuman |\nThis |\n_Snapshot|$)/i);
  if (keyBlock?.[1]) {
    for (const line of keyBlock[1].split("\n")) {
      const point = line.replace(/^[-*]\s*/, "").trim();
      if (point) keyPoints.push(point);
    }
  }

  const excerptMatch = cleaned.match(/\*\*Excerpt:\*\*\s*\n(?:>\s*)?([\s\S]*?)(?=\n\*\*|\n@|\nHuman |\nThis |\n_Snapshot|$)/i);
  let excerpt = excerptMatch?.[1]?.trim();
  if (excerpt) {
    excerpt = excerpt
      .split("\n")
      .map((l) => l.replace(/^>\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
  }

  // Trailing @mention / notice after the structured block.
  const noticeMatch = cleaned.match(/\n(@[^\n]+(?:\n(?!\*\*)[^\n]+)*)\s*$/);
  let notice = noticeMatch?.[1]?.trim();
  if (notice && /\*\*/.test(notice)) notice = undefined;

  return {
    subject,
    participants,
    summary,
    keyPoints: keyPoints.slice(0, 6),
    excerpt,
    inboxDeepLink,
    notice,
  };
}
