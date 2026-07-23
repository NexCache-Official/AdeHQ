export type CallChimeKind = "connected" | "disconnected";

/**
 * Tiny local Web Audio cue. No network fetch, TTS request, or usage charge.
 * Callers may suppress it through their OS/browser audio preferences.
 */
export function playCallChime(
  context: AudioContext,
  kind: CallChimeKind,
): void {
  if (context.state !== "running") return;
  const now = context.currentTime;
  const notes = kind === "connected" ? [660, 880] : [520, 390];
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
  gain.connect(context.destination);
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    const start = now + index * 0.065;
    oscillator.start(start);
    oscillator.stop(start + 0.09);
  });
}

