/** User intent during Maya recruiter chat — not keyword-based role detection. */
export type RecruiterUserIntent =
  | "gathering"
  | "approve_brief"
  | "review_brief"
  | "generate_candidates";

const NEGATIVE_ADJUST =
  /\b(not|don't|do not|unhappy|change|update|adjust|wrong|fix|edit|refine|more detail|instead)\b/i;

export function detectRecruiterUserIntent(text: string): RecruiterUserIntent {
  const trimmed = text.trim();
  if (!trimmed) return "gathering";
  const lower = trimmed.toLowerCase();

  if (
    /\b(review (the )?job brief|review (the )?brief|show (me )?(the )?brief|open (the )?brief)\b/i.test(
      lower,
    )
  ) {
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
    /\b(i'?m |im )?(happy|good|great|looks good|sounds good|perfect|fine|all set|ready|approved)\b/i.test(
      lower,
    ) &&
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
