/**
 * Progressive spoken fillers so long Brain/tool waits feel human — short
 * thinking beats while AdeHQ works, then stop as soon as real answer audio starts.
 */

import {
  LIVE_CALL_BRIDGE_PHRASES,
  LIVE_CALL_LEAD_IN_PHRASES,
  LIVE_CALL_THINKING_PHRASES,
  LIVE_CALL_WORKING_PHRASES,
  pickBridgePhrase,
} from "./bridge-phrases";

export type FillerPhase = "thinking" | "searching" | "working" | "lead_in";

export const THINKING_FILLERS = LIVE_CALL_THINKING_PHRASES;
export const SEARCHING_FILLERS = LIVE_CALL_BRIDGE_PHRASES;
export const WORKING_FILLERS = LIVE_CALL_WORKING_PHRASES;
export const LEAD_IN_FILLERS = LIVE_CALL_LEAD_IN_PHRASES;

const PHASE_PHRASES: Record<FillerPhase, readonly string[]> = {
  thinking: THINKING_FILLERS,
  searching: SEARCHING_FILLERS,
  working: WORKING_FILLERS,
  lead_in: LEAD_IN_FILLERS,
};

export function pickIntelligentFiller(
  seed: string,
  phase: FillerPhase,
  used: ReadonlySet<string> = new Set(),
): string {
  const phrases = PHASE_PHRASES[phase];
  const unused = phrases.filter((phrase) => !used.has(phrase));
  const pool = unused.length > 0 ? unused : phrases;
  return pickBridgePhrase(seed, pool);
}

export type ProgressiveFillerScheduler = {
  start: (phase: FillerPhase) => void;
  bump: (phase: FillerPhase) => void;
  stop: () => void;
  readonly spoken: readonly string[];
};

/**
 * Speaks an immediate filler, then another after `intervalMs` if still waiting.
 * Caps at `maxPhrases` so the call never becomes a monologue of hedges.
 */
export function createProgressiveFillerScheduler(input: {
  seed: string;
  intervalMs?: number;
  maxPhrases?: number;
  speak: (phrase: string, phase: FillerPhase) => void;
}): ProgressiveFillerScheduler {
  const intervalMs = input.intervalMs ?? 2_200;
  const maxPhrases = input.maxPhrases ?? 3;
  const used = new Set<string>();
  const spoken: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let phase: FillerPhase = "thinking";
  let count = 0;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const speakNext = (nextPhase: FillerPhase, force = false) => {
    if (stopped) return;
    if (!force && count >= maxPhrases) return;
    phase = nextPhase;
    const phrase = pickIntelligentFiller(
      `${input.seed}:${phase}:${count}`,
      phase,
      used,
    );
    used.add(phrase);
    spoken.push(phrase);
    count += 1;
    input.speak(phrase, phase);
    clear();
    if (count < maxPhrases) {
      timer = setTimeout(() => speakNext("working"), intervalMs);
    }
  };

  return {
    get spoken() {
      return spoken;
    },
    start(nextPhase) {
      if (stopped || count > 0) {
        this.bump(nextPhase);
        return;
      }
      speakNext(nextPhase, true);
    },
    bump(nextPhase) {
      if (stopped) return;
      phase = nextPhase;
      if (!timer && count < maxPhrases && count > 0) {
        timer = setTimeout(() => speakNext(phase), Math.min(900, intervalMs));
      }
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
