/**
 * Round a list of raw hour values to 2dp so their sum equals `targetDisplay`.
 * Uses largest-remainder so breakdown rows match the plan / team total.
 */
export function allocateDisplayHours(rawHours: number[], targetDisplay: number): number[] {
  if (rawHours.length === 0) return [];
  const targetCents = Math.round(targetDisplay * 100);
  const floors = rawHours.map((h) => {
    const scaled = Math.max(0, h) * 100;
    return Math.floor(scaled + 1e-9);
  });
  const order = rawHours
    .map((h, i) => ({ i, frac: Math.max(0, h) * 100 - floors[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  let sum = floors.reduce((a, b) => a + b, 0);
  const out = [...floors];
  let rem = targetCents - sum;

  if (rem > 0) {
    for (let k = 0; k < order.length && rem > 0; k++) {
      out[order[k]!.i]! += 1;
      rem -= 1;
    }
  } else if (rem < 0) {
    const bySize = out
      .map((cents, i) => ({ i, cents }))
      .filter((row) => row.cents > 0)
      .sort((a, b) => b.cents - a.cents || a.i - b.i);
    for (let k = 0; k < bySize.length && rem < 0; k++) {
      out[bySize[k]!.i]! -= 1;
      rem += 1;
    }
  }

  return out.map((cents) => cents / 100);
}
