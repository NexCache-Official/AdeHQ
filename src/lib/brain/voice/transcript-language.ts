/**
 * Live-call STT language helpers. Without an explicit language, managed STT can
 * invent phrases in the wrong script (e.g. Russian "Продолжение следует..." for
 * English speech). AdeHQ therefore prefers an explicit locale and repairs
 * obvious script mismatches.
 */

const CYRILLIC = /[\u0400-\u04FF]/;
const LATIN = /[A-Za-z]/;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const ARABIC = /[\u0600-\u06FF]/;

export function normalizeSpeechLanguage(raw?: string | null): string {
  const value = (raw ?? "en").trim().toLowerCase();
  if (!value) return "en";
  const primary = value.split(/[-_]/)[0] ?? "en";
  return primary || "en";
}

export function transcriptLooksLikeLanguageMismatch(
  text: string,
  expectedLanguage = "en",
): boolean {
  const expected = normalizeSpeechLanguage(expectedLanguage);
  const sample = text.trim();
  if (sample.length < 2) return false;

  const letters = sample.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;

  const cyrillic = (letters.match(new RegExp(CYRILLIC.source, "g")) ?? []).length;
  const latin = (letters.match(new RegExp(LATIN.source, "g")) ?? []).length;
  const cjk = (letters.match(new RegExp(CJK.source, "g")) ?? []).length;
  const arabic = (letters.match(new RegExp(ARABIC.source, "g")) ?? []).length;
  const dominantShare = (count: number) => count / letters.length >= 0.45;

  if (expected === "en" || expected === "es" || expected === "fr" || expected === "de") {
    return dominantShare(cyrillic) || dominantShare(cjk) || dominantShare(arabic);
  }
  if (expected === "ru" || expected === "uk" || expected === "bg") {
    return dominantShare(latin) && cyrillic / letters.length < 0.2;
  }
  return false;
}
