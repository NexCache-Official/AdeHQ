/** User intent during Maya recruiter chat — not keyword-based role detection. */
export type RecruiterUserIntent =
  | "gathering"
  | "approve_brief"
  | "review_brief"
  | "generate_candidates";

const NEGATIVE_ADJUST =
  /\b(not|don't|do not|unhappy|change|update|adjust|wrong|fix|edit|refine|more detail|instead)\b/i;

/** User wants to open/review the brief or move forward — not answer a discovery question. */
export function isProceedToBriefAction(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;

  if (
    /\b(review (the )?(full )?job brief|review (the )?(full )?brief|want to review (the )?(full )?brief|show (me )?(the )?(full )?brief|open (the )?brief)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  return /\b(go ahead and hire|jump straight (to|into) hiring|straight to hiring|ready to hire|let'?s hire|proceed to hire|hire now|start hiring|skip to hiring|move on to hiring|begin hiring|finalize (the )?brief|move to (the )?brief)\b/i.test(
    lower,
  );
}

/** Flow-control chip/reply — not substantive role content for the brief. */
export function isHiringFlowMetaReply(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  if (/^not sure — help me decide$/i.test(lower)) return true;
  if (/^help me decide$/i.test(lower)) return true;
  if (
    /\b(tweak|adjust|change|update|refine|edit|modify)\s+(anything|something)\s+else\b/i.test(lower)
  ) {
    return true;
  }
  if (/\b(move on|let'?s move on|keep going|next question|that'?s enough|nothing else)\b/i.test(lower)) {
    return true;
  }
  if (/^(ok|okay|i'?m ok|im ok|i'?m okay|im okay)[,!.?\s]*(let'?s )?(move on|continue|go ahead)?[!.?]*$/i.test(lower)) {
    return true;
  }
  return false;
}

/** True when the user's message should not mutate brief fields (navigation, approval, meta chips). */
export function shouldSkipBriefMutationForMessage(text: string): boolean {
  return (
    shouldSkipBriefUpdateIntent(detectRecruiterUserIntent(text)) || isHiringFlowMetaReply(text)
  );
}

export function mayaReplyForHiringFlowMeta(text: string): string | null {
  if (!isHiringFlowMetaReply(text)) return null;
  return "Sure — what would you like to change? Mission, responsibilities, focus areas, or something else?";
}

export function detectRecruiterUserIntent(text: string): RecruiterUserIntent {
  const trimmed = text.trim();
  if (!trimmed) return "gathering";
  const lower = trimmed.toLowerCase();

  if (isProceedToBriefAction(lower)) {
    return "review_brief";
  }

  if (
    /\b(shortlist|generate candidates|show candidates|find candidates|start shortlist|create candidates)\b/i.test(
      lower,
    ) ||
    (/\b(happy|good|great|looks good|sounds good|perfect|all set|ready|approved|proceed|go ahead)\b/i.test(
      lower,
    ) &&
      /\b(shortlist|candidates|generate|let'?s go)\b/i.test(lower))
  ) {
    return "generate_candidates";
  }

  if (
    /\b(i'?m |im )?(happy|good|great|looks good|sounds good|perfect|fine|all set|ready|approved|okay|ok)\b/i.test(
      lower,
    ) &&
    !NEGATIVE_ADJUST.test(lower)
  ) {
    return "approve_brief";
  }

  if (
    /\b(move on|let'?s move on|keep going|nothing else to add|that covers it)\b/i.test(lower) &&
    !NEGATIVE_ADJUST.test(lower)
  ) {
    return "approve_brief";
  }

  return "gathering";
}

export function mayaReplyForRecruiterIntent(intent: RecruiterUserIntent): string | null {
  switch (intent) {
    case "approve_brief":
      return "Perfect — the brief looks good. Review it when you're ready, or I can shortlist candidates now.";
    case "generate_candidates":
      return "Great — I'll shortlist three candidates that fit this brief.";
    case "review_brief":
      return "Opening the job brief for you now.";
    default:
      return null;
  }
}

export function shouldSkipBriefUpdateIntent(intent: RecruiterUserIntent): boolean {
  return intent !== "gathering";
}
