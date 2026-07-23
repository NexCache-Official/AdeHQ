export type SpeechChunkPolicy = {
  preferredMinCharacters: number;
  maximumCharacters: number;
  maximumWaitMs: number;
  breakOn: readonly string[];
};

export const DEFAULT_SPEECH_CHUNK_POLICY: SpeechChunkPolicy = {
  // Keep first spoken audio snappy on calls — waiting for ~45 chars added a
  // noticeable gap where the transcript appeared before any voice.
  preferredMinCharacters: 28,
  maximumCharacters: 160,
  maximumWaitMs: 320,
  breakOn: [".", "!", "?", ";", ":", ",", "—", "-"],
};

const ABBREVIATIONS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "e.g.",
  "i.e.",
  "vs.",
  "etc.",
]);

export function sanitizeTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " I’ve put the code in the transcript. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link in the transcript")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\[(?:\d+|source:[^\]]+)\]/gi, "")
    .replace(/\|/g, ", ")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeBreakIndex(text: string, policy: SpeechChunkPolicy): number {
  const limit = Math.min(text.length, policy.maximumCharacters);
  if (text.length >= policy.preferredMinCharacters) {
    for (let index = 0; index < limit; index += 1) {
    const char = text[index];
    if (!policy.breakOn.includes(char)) continue;
    const word = text.slice(Math.max(0, index - 8), index + 1).toLowerCase().trim();
    if ([...ABBREVIATIONS].some((abbr) => word.endsWith(abbr))) continue;
    if (char === "." && /\d\.\d$/.test(text.slice(Math.max(0, index - 2), index + 2))) {
      continue;
    }
    return index + 1;
    }
  }
  if (text.length >= policy.maximumCharacters) {
    const whitespace = text.lastIndexOf(" ", policy.maximumCharacters);
    return whitespace >= policy.preferredMinCharacters
      ? whitespace
      : policy.maximumCharacters;
  }
  return -1;
}

export class SpeechChunker {
  private buffer = "";
  private lastPushAt = Date.now();

  constructor(
    private readonly policy: SpeechChunkPolicy = DEFAULT_SPEECH_CHUNK_POLICY,
  ) {}

  push(delta: string, now = Date.now()): string[] {
    this.buffer += delta;
    this.lastPushAt = now;
    return this.drain(false);
  }

  flushIfTimedOut(now = Date.now()): string[] {
    if (
      this.buffer.trim().length < this.policy.preferredMinCharacters ||
      now - this.lastPushAt < this.policy.maximumWaitMs
    ) {
      return [];
    }
    return this.drain(true);
  }

  finish(): string[] {
    const chunks = this.drain(true);
    if (this.buffer.trim()) chunks.push(sanitizeTextForSpeech(this.buffer));
    this.buffer = "";
    return chunks.filter(Boolean);
  }

  private drain(force: boolean): string[] {
    const chunks: string[] = [];
    while (this.buffer.trim()) {
      const index = safeBreakIndex(this.buffer, this.policy);
      if (index < 0 && !force) break;
      if (index < 0) {
        if (this.buffer.length < this.policy.preferredMinCharacters) break;
        const forced = this.buffer.lastIndexOf(" ", this.policy.maximumCharacters);
        const end = forced > 0 ? forced : Math.min(this.buffer.length, this.policy.maximumCharacters);
        const chunk = sanitizeTextForSpeech(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end).trimStart();
        if (chunk) chunks.push(chunk);
        continue;
      }
      const chunk = sanitizeTextForSpeech(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index).trimStart();
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  }
}
