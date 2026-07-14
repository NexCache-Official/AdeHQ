import type { EmployeeRoleKey } from "@/lib/types";
import { defaultModelModeForRole, type ModelMode } from "./model-catalog";
import { messageLikelyNeedsStructuredEffects } from "./message-intent";
import {
  artifactAskNeedsStrongModel,
  isDriveArtifactAsk,
} from "./detect-drive-artifact-ask";

const DEEP_RESEARCH_PATTERNS = [
  /\bdeep dive\b/i,
  /\bcomprehensive research\b/i,
  /\bthorough analysis\b/i,
  /\bwith (many |multiple )?sources\b/i,
  /\battached files?\b/i,
  /\blong[- ]form report\b/i,
  /\bdetailed research\b/i,
];

const STRATEGY_PATTERNS = [
  /\bstrategy\b/i,
  /\bstrategic plan\b/i,
  /\bgo-to-market\b/i,
  /\bcompetitive analysis\b/i,
  /\broadmap\b/i,
];

const DRAFT_COPY_PATTERNS = [
  /\bdraft\b/i,
  /\bwrite (an? |the )?email\b/i,
  /\boutreach\b/i,
  /\bcopy\b/i,
];

const SHORT_ANSWER_PATTERNS = [
  /^(what|who|when|where|why|how|is|are|can|do|does)\b/i,
  /\?$/,
];

function needsLongContext(message: string): boolean {
  return DEEP_RESEARCH_PATTERNS.some((p) => p.test(message));
}

function needsStrongReasoning(message: string): boolean {
  return STRATEGY_PATTERNS.some((p) => p.test(message)) && message.length > 80;
}

/**
 * Pick model mode per run — prefer fast balanced paths for panel opinions and room chat.
 * Drive artifact / tool work uses structured-friendly balanced/strong — never MiniMax
 * long_context solely because the employee role defaults to research.
 */
export function resolveRunModelMode(params: {
  roleKey: EmployeeRoleKey;
  employeeModelMode?: ModelMode | null;
  isGreetingRun?: boolean;
  conversationMode?: string;
  collaborationRole?: string;
  userMessage: string;
}): ModelMode {
  const { userMessage, isGreetingRun, conversationMode, roleKey } = params;
  const text = userMessage.trim();

  if (isGreetingRun || conversationMode === "broadcast_social") {
    return "cheap";
  }

  if (roleKey === "engineering" || roleKey === "gamedev") {
    if (/\b(code|bug|fix|implement|refactor|api|typescript)\b/i.test(text)) {
      return "coding";
    }
  }

  // Artifact/tool deliverables first: structured JSON + toolCalls need Flash/Pro,
  // not long_context MiniMax (burns tokens and often drops toolCalls).
  if (isDriveArtifactAsk(text) || messageLikelyNeedsStructuredEffects(text)) {
    if (artifactAskNeedsStrongModel(text) || needsStrongReasoning(text)) {
      return "strong";
    }
    return "balanced";
  }

  if (needsLongContext(text)) {
    return "long_context";
  }

  if (needsStrongReasoning(text)) {
    return "strong";
  }

  const isPanel =
    conversationMode === "panel_response" ||
    params.collaborationRole === "panelist";
  const isShortOpinion =
    isPanel ||
    (SHORT_ANSWER_PATTERNS.some((p) => p.test(text)) && text.length < 120);

  if (isShortOpinion && !DRAFT_COPY_PATTERNS.some((p) => p.test(text))) {
    return "balanced";
  }

  if (DRAFT_COPY_PATTERNS.some((p) => p.test(text))) {
    return "balanced";
  }

  if (
    conversationMode === "lead_collaborator" ||
    conversationMode === "ambient_collaboration" ||
    conversationMode === "direct_reply"
  ) {
    return "balanced";
  }

  const roleDefault = params.employeeModelMode ?? defaultModelModeForRole(roleKey);
  if (roleDefault === "long_context" && !needsLongContext(text)) {
    return "balanced";
  }

  return roleDefault;
}
