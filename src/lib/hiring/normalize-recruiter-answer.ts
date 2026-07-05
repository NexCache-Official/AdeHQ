/** Strip list conjunctions accidentally captured from comma/or-separated options. */
export function normalizeRecruiterAnswer(text: string): string {
  let cleaned = text.trim();
  if (!cleaned) return cleaned;

  cleaned = cleaned
    .replace(/^(?:or|and)\s+/i, "")
    .replace(/^(will it focus on|should it|could it|would it)\s+/i, "")
    .replace(/^on\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/[.)]+$/g, "")
    .trim();

  if (!cleaned) return text.trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
