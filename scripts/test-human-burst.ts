/**
 * Human burst dedupe + typing quiet helpers.
 * Usage: npx tsx scripts/test-human-burst.ts
 */

import {
  buildBurstStewardContext,
  burstMessagesSince,
  formatTypingHumansLabel,
  HUMAN_TYPING_QUIET_MS,
  isNearDuplicate,
  normalizeHumanMessageForDedupe,
  selectDistinctBurstMessages,
  type BurstHumanMessage,
} from "../src/lib/orchestration/human-burst";

function expectTrue(condition: boolean, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function main() {
  await test("normalize collapses case and punctuation", () => {
    expectTrue(
      normalizeHumanMessageForDedupe("Hello, World!!!") ===
        normalizeHumanMessageForDedupe("hello world"),
    );
  });

  await test("near-duplicate detects identical and tiny edits", () => {
    expectTrue(isNearDuplicate("What's the ARR?", "whats the arr"));
    expectTrue(isNearDuplicate("hello!", "hello"));
    expectTrue(!isNearDuplicate("What's the ARR?", "What's the burn rate?"));
  });

  await test("selectDistinctBurstMessages drops duplicates across authors", () => {
    const msgs: BurstHumanMessage[] = [
      {
        id: "1",
        senderId: "a",
        senderName: "Alex",
        content: "Can you draft the deck?",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
      {
        id: "2",
        senderId: "b",
        senderName: "Sam",
        content: "can you draft the deck",
        createdAt: "2026-07-15T12:00:01.000Z",
      },
      {
        id: "3",
        senderId: "a",
        senderName: "Alex",
        content: "Include Q3 numbers too",
        createdAt: "2026-07-15T12:00:02.000Z",
      },
    ];
    const distinct = selectDistinctBurstMessages(msgs);
    expectTrue(distinct.length === 2, `expected 2 got ${distinct.length}`);
    expectTrue(distinct[1]!.content.includes("Q3"));
  });

  await test("buildBurstStewardContext prefers latest and labels authors", () => {
    const burst = buildBurstStewardContext([
      {
        id: "1",
        senderId: "a",
        senderName: "Alex",
        content: "Look at competitors",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
      {
        id: "2",
        senderId: "b",
        senderName: "Sam",
        content: "Focus on Series B peers",
        createdAt: "2026-07-15T12:00:03.000Z",
      },
    ]);
    expectTrue(burst.triggerMessageId === "2");
    expectTrue(burst.messageIds.length === 2);
    expectTrue(/Alex:/.test(burst.combinedText) && /Sam:/.test(burst.combinedText));
    expectTrue(burst.authorSummary.includes("Alex") && burst.authorSummary.includes("Sam"));
  });

  await test("burstMessagesSince respects lookback and sinceAi", () => {
    const now = Date.parse("2026-07-15T12:10:00.000Z");
    const msgs: BurstHumanMessage[] = [
      {
        id: "old",
        senderId: "a",
        senderName: "Alex",
        content: "old",
        createdAt: "2026-07-15T11:00:00.000Z",
      },
      {
        id: "mid",
        senderId: "a",
        senderName: "Alex",
        content: "mid",
        createdAt: "2026-07-15T12:09:10.000Z",
      },
      {
        id: "new",
        senderId: "b",
        senderName: "Sam",
        content: "new",
        createdAt: "2026-07-15T12:09:40.000Z",
      },
    ];
    // lookback floor is now-120s (=12:08); sinceAi 12:09:00 → floor 12:09:00
    const windowed = burstMessagesSince(msgs, {
      sinceIso: "2026-07-15T12:09:00.000Z",
      nowMs: now,
    });
    expectTrue(windowed.map((m) => m.id).join(",") === "mid,new");
    const lookbackOnly = burstMessagesSince(msgs, { nowMs: now, lookbackMs: 30_000 });
    expectTrue(lookbackOnly.map((m) => m.id).join(",") === "new");
  });

  await test("formatTypingHumansLabel ignores local user", () => {
    expectTrue(
      formatTypingHumansLabel(
        [
          { userId: "me", displayName: "Me" },
          { userId: "a", displayName: "Alex" },
        ],
        "me",
      ) === "Alex is typing…",
    );
    expectTrue(
      formatTypingHumansLabel(
        [
          { userId: "a", displayName: "Alex" },
          { userId: "b", displayName: "Sam" },
        ],
        "me",
      ) === "Alex and Sam are typing…",
    );
  });

  await test("quiet window constant is 5 seconds", () => {
    expectTrue(HUMAN_TYPING_QUIET_MS === 5000);
  });

  console.log("\nAll human-burst tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
