const FIRST_NAMES = [
  "Riley",
  "Jordan",
  "Alex",
  "Morgan",
  "Casey",
  "Quinn",
  "Avery",
  "Cameron",
  "Dakota",
  "Ellis",
  "Harper",
  "Jamie",
  "Kai",
  "Logan",
  "Noah",
  "Parker",
  "Reese",
  "Sage",
  "Taylor",
  "Blake",
  "Drew",
  "Emery",
  "Finley",
  "Hayden",
  "Jules",
  "Lane",
  "Marlowe",
  "Nico",
  "Rowan",
  "Skyler",
  "Tatum",
  "Wren",
  "Adrian",
  "Bianca",
  "Cole",
  "Diana",
  "Elena",
  "Felix",
  "Greta",
  "Hugo",
  "Iris",
  "Jonah",
  "Lena",
  "Miles",
  "Nina",
  "Oscar",
  "Priya",
  "Rafael",
  "Sofia",
  "Theo",
];

const LAST_NAMES = [
  "Carter",
  "Ellis",
  "Vale",
  "Brooks",
  "Chen",
  "Reed",
  "Hayes",
  "Monroe",
  "Santos",
  "Nguyen",
  "Patel",
  "Kim",
  "Foster",
  "Grant",
  "Shaw",
  "Walsh",
  "Banks",
  "Cross",
  "Dunn",
  "Finch",
  "Hart",
  "Klein",
  "Lowe",
  "Marsh",
  "Nash",
  "Olsen",
  "Price",
  "Quinn",
  "Ross",
  "Stone",
  "Turner",
  "Vance",
  "Webb",
  "York",
  "Abbott",
  "Blair",
  "Coleman",
  "Drake",
  "Edwards",
  "Fleming",
  "Gibson",
  "Holt",
  "Ingram",
  "Jensen",
  "Kerr",
  "Lloyd",
  "Meyer",
  "Norris",
  "Owens",
  "Porter",
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic unique full names for a hiring session (always 3 distinct). */
export function generateUniqueCandidateNames(seed: string, count = 3): string[] {
  const names = new Set<string>();
  let attempt = 0;
  const base = hashSeed(seed);

  while (names.size < count && attempt < 200) {
    const h = (base + attempt * 9973) >>> 0;
    const first = FIRST_NAMES[h % FIRST_NAMES.length];
    const last = LAST_NAMES[(h >>> 8) % LAST_NAMES.length];
    const full = `${first} ${last}`;
    if (!names.has(full)) names.add(full);
    attempt += 1;
  }

  while (names.size < count) {
    const suffix = names.size + 1;
    names.add(`Candidate ${suffix}`);
  }

  return [...names];
}
