import {
  realignSearchCitations,
  buildWebSourcesArtifactFromCards,
  finalizeReplayedSearchPresentation,
} from "@/lib/ai/search/source-normalizer";
import type {
  NormalizedSearchSources,
  SearchSourceCard,
} from "@/lib/ai/search/source-normalizer";
import type { SearchSource } from "@/lib/ai/search/types";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function card(id: string, url: string, overrides: Partial<SearchSourceCard> = {}): SearchSourceCard {
  return {
    id,
    title: `Title ${id}`,
    url,
    domain: new URL(url).hostname.replace(/^www\./, ""),
    sourceType: "business_press",
    confidence: "high",
    usedInAnswer: true,
    ...overrides,
  };
}

function markersIn(text: string): number[] {
  return [...text.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
}

// --- Production shape: Apple revenue trace ---------------------------------
// 7 raw sources (synthesis order s1..s7); model cites [1],[5],[6],[7].
// Normalizer keeps top-5 (reranked) and pushes s6,s7 to overflow/excluded.
const rawSources: SearchSource[] = Array.from({ length: 7 }, (_, i) => ({
  title: `Title s${i + 1}`,
  url: `https://example${i + 1}.com/article`,
}));

// used is reranked (order differs from raw): s3, s1, s5, s2, s4
const used: SearchSourceCard[] = [
  card("c3", "https://example3.com/article"),
  card("c1", "https://example1.com/article"),
  card("c5", "https://example5.com/article"),
  card("c2", "https://example2.com/article"),
  card("c4", "https://example4.com/article"),
];
const excluded: SearchSourceCard[] = [
  card("c6", "https://example6.com/article", {
    usedInAnswer: false,
    excludedReason: "Lower-ranked source omitted from answer.",
  }),
  card("c7", "https://example7.com/article", {
    usedInAnswer: false,
    excludedReason: "Lower-ranked source omitted from answer.",
  }),
];
const normalized: NormalizedSearchSources = {
  used,
  excluded,
  sourceCount: 7,
  usedSourceCount: 5,
  excludedSourceCount: 2,
};

const answer =
  "Apple's Q1 revenue was $143.8 billion [1]. Q2 came in at $111.2 billion [5][6][7].";

const aligned = realignSearchCitations({ text: answer, rawSources, normalized });

// Every previously-cited source is now visible (s6, s7 pulled back).
assert(aligned.sources.length === 7, `expected 7 display sources, got ${aligned.sources.length}`);
assert(
  aligned.sources.some((s) => s.url === "https://example6.com/article") &&
    aligned.sources.some((s) => s.url === "https://example7.com/article"),
  "cited-but-excluded sources s6/s7 must be pulled into the display list",
);

// Every marker in the rewritten text resolves to a real, clickable source.
const outMarkers = markersIn(aligned.text);
assert(outMarkers.length > 0, "rewritten text must still carry citation markers");
for (const n of outMarkers) {
  const source = aligned.sources[n - 1];
  assert(
    Boolean(source && source.url),
    `marker [${n}] must resolve to a display source with a url`,
  );
}

// Markers were renumbered to the display order, not left at raw numbering.
// s1 was raw [1]; in display order (s3,s1,s5,s2,s4,s6,s7) it is now [2].
assert(aligned.text.includes("$143.8 billion [2]"), `s1 marker should renumber to [2]: ${aligned.text}`);
// s5 was raw [5]; now [3]. s6 stays [6], s7 stays [7].
assert(aligned.text.includes("[3]"), `s5 marker should renumber to [3]: ${aligned.text}`);
assert(aligned.text.includes("[6]") && aligned.text.includes("[7]"), `s6/s7 markers preserved: ${aligned.text}`);

// --- Out-of-range and unresolved markers are dropped, not left dangling ----
const withJunk = realignSearchCitations({
  text: "Solid quarter [1] but this is bogus [9] and this too [42].",
  rawSources,
  normalized,
});
for (const n of markersIn(withJunk.text)) {
  assert(n <= withJunk.sources.length, `no marker may exceed display count: saw [${n}]`);
}
assert(!withJunk.text.includes("[9]") && !withJunk.text.includes("[42]"), "out-of-range markers must be dropped");

// --- No sources at all: returns cleanly, no markers left ---------------------
const empty = realignSearchCitations({
  text: "Nothing verifiable here [1].",
  rawSources: [],
  normalized: { used: [], excluded: [], sourceCount: 0, usedSourceCount: 0, excludedSourceCount: 0 },
});
assert(empty.sources.length === 0, "empty inputs yield no sources");
assert(markersIn(empty.text).length === 0, "markers must be stripped when nothing resolves");

// --- Artifact numbering matches the aligned display order -------------------
const artifact = buildWebSourcesArtifactFromCards(aligned.sources, {
  sourceCount: normalized.sourceCount,
  excludedSourceCount: 0,
});
const webSources = artifact.meta?.webSources ?? [];
assert(webSources.length === 7, "artifact must carry all 7 display sources");
assert(
  webSources[1]?.url === "https://example1.com/article",
  "artifact position 2 must be s1, matching the [2] marker",
);

// --- Cache/session replay must preserve the same alignment ------------------
const replayed = finalizeReplayedSearchPresentation({
  answer,
  sources: rawSources,
  query: "Apple quarterly revenue",
});
const replaySources = replayed.artifact?.meta?.webSources ?? [];
assert(replaySources.length === 7, "replay must pull cited sources 6 and 7 back into the artifact");
for (const n of markersIn(replayed.answer)) {
  assert(
    replaySources[n - 1]?.url === replayed.sources[n - 1]?.url,
    `replayed marker [${n}] must resolve to the matching artifact source`,
  );
}
assert(
  !markersIn(replayed.answer).some((n) => n > replaySources.length),
  "replayed answer must not contain an out-of-range citation marker",
);

console.log("✓ realignSearchCitations: markers renumbered, hidden citations recovered, junk dropped");
console.log("✓ buildWebSourcesArtifactFromCards: artifact order matches inline markers");
console.log("✓ cached/session replay keeps citation markers aligned with Sources cards");
console.log("All search citation tests passed.");
