/**
 * V20.0.5 — Clear chat context hardening tests.
 * Usage: npm run test:clear-chat-context
 */

import {
  CHAT_CLEARED_METADATA_KEY,
  fetchTopicSummary,
} from "@/lib/topic-summary/persistence";
import {
  fetchTopicChatClearedAtColumn,
  fetchTopicContextEpochId,
  markTopicConversationCleared,
} from "@/lib/conversation-context/epochs";
import { buildTopicSummaryContextBlock } from "@/lib/topic-summary/generate";

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

type FakeTable = Record<string, Record<string, unknown>[]>;

function createFakeClient(state: {
  topics: Record<string, unknown>[];
  topicSummaries: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  epochs: Record<string, unknown>[];
}) {
  const tables: FakeTable = {
    topics: state.topics,
    topic_summaries: state.topicSummaries,
    messages: state.messages,
    conversation_context_epochs: state.epochs,
    topic_orchestration_state: [],
  };

  const client = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let patch: Record<string, unknown> | null = null;
      let insertRow: Record<string, unknown> | null = null;
      let deleteMode = false;
      let countMode = false;

      const api = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          countMode = opts?.count === "exact" && opts?.head === true;
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return api;
        },
        gte(col: string, val: unknown) {
          filters.push((row) => String(row[col] ?? "") >= String(val));
          return api;
        },
        is(col: string, val: unknown) {
          filters.push((row) => (val === null ? row[col] == null : row[col] === val));
          return api;
        },
        order(col: string, opts: { ascending: boolean }) {
          rows.sort((a, b) => {
            const av = String(a[col]);
            const bv = String(b[col]);
            return opts.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
          });
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          const matched = rows.filter((row) => filters.every((f) => f(row)));
          return { data: matched[0] ?? null, error: null };
        },
        single: async () => {
          const matched = rows.filter((row) => filters.every((f) => f(row)));
          return { data: matched[0] ?? null, error: null };
        },
        update(next: Record<string, unknown>) {
          patch = next;
          return api;
        },
        insert(row: Record<string, unknown>) {
          insertRow = row;
          return {
            select: () => ({
              maybeSingle: async () => {
                const stored = { ...row, id: row.id ?? "epoch_new" };
                rows.push(stored);
                return { data: stored, error: null };
              },
            }),
          };
        },
        delete: () => {
          deleteMode = true;
          return api;
        },
        then: (
          resolve: (value: { error: null; count?: number }) => void,
        ) => {
          if (countMode) {
            const matched = rows.filter((row) => filters.every((f) => f(row)));
            resolve({ count: matched.length, error: null });
            return;
          }
          if (deleteMode) {
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              if (filters.every((f) => f(rows[i]))) rows.splice(i, 1);
            }
            resolve({ error: null });
            return;
          }
          if (patch) {
            for (const row of rows) {
              if (filters.every((f) => f(row))) Object.assign(row, patch);
            }
          }
          resolve({ error: null });
        },
      };
      return api;
    },
  };

  return client as unknown as import("@supabase/supabase-js").SupabaseClient;
}

async function main() {
  await test("markTopicConversationCleared sets chat_cleared_at and epoch metadata", async () => {
    const topics: Record<string, unknown>[] = [
      {
        id: "topic_1",
        workspace_id: "ws_1",
        metadata: {},
      },
    ];
    const client = createFakeClient({ topics, topicSummaries: [], messages: [], epochs: [] });
    const result = await markTopicConversationCleared(client, {
      workspaceId: "ws_1",
      roomId: "room_1",
      topicId: "topic_1",
    });
    expectTrue(Boolean(result.chatClearedAt), "expected chatClearedAt");
    expectTrue(topics[0].chat_cleared_at != null, "expected chat_cleared_at column");
    const metadata = topics[0].metadata as Record<string, unknown>;
    expectTrue(
      typeof metadata[CHAT_CLEARED_METADATA_KEY] === "string" ||
        typeof metadata.chatClearedAt === "string",
    );
  });

  await test("fetchTopicSummary hides summary refreshed before clear", async () => {
    const clearedAt = "2026-07-05T12:00:00.000Z";
    const client = createFakeClient({
      topics: [
        {
          id: "topic_1",
          workspace_id: "ws_1",
          metadata: { chatClearedAt: clearedAt },
          chat_cleared_at: clearedAt,
        },
      ],
      topicSummaries: [
        {
          id: "sum_1",
          workspace_id: "ws_1",
          topic_id: "topic_1",
          room_id: "room_1",
          summary: "Old Supabase funding brief",
          what_happened: "Discussed Supabase",
          last_refreshed_at: "2026-07-05T10:00:00.000Z",
          open_questions: [],
          key_facts: [{ text: "Supabase raised X" }],
          next_actions: [],
          suggested_memory: [],
        },
      ],
      messages: [
        {
          id: "msg_new",
          workspace_id: "ws_1",
          topic_id: "topic_1",
          created_at: "2026-07-05T13:00:00.000Z",
        },
      ],
      epochs: [],
    });

    const summary = await fetchTopicSummary(client, "ws_1", "topic_1");
    expectTrue(summary === null, "stale summary after clear should be hidden");
  });

  await test("buildTopicSummaryContextBlock excludes previous summary when existing null", () => {
    const block = buildTopicSummaryContextBlock({
      topicTitle: "Direct Chat",
      messages: [
        {
          id: "msg_a",
          senderName: "Praveen",
          content: "What was Anthropic's revenue in 2025?",
          createdAt: "2026-07-05T13:00:00.000Z",
        },
      ],
      tasks: [],
      memory: [{ title: "Saved Supabase note", content: "Old saved memory", status: "saved" }],
      approvals: [],
      workLogs: [],
      employees: [],
      existing: null,
    });
    expectTrue(!block.includes("Old Supabase funding brief"));
    expectTrue(block.includes("Anthropic"));
  });

  await test("epoch helpers read column and metadata fallback", async () => {
    const client = createFakeClient({
      topics: [
        {
          id: "topic_1",
          workspace_id: "ws_1",
          chat_cleared_at: "2026-07-05T12:00:00.000Z",
          current_context_epoch_id: "epoch_1",
          metadata: {},
        },
      ],
      topicSummaries: [],
      messages: [],
      epochs: [],
    });
    const clearedAt = await fetchTopicChatClearedAtColumn(client, "ws_1", "topic_1");
    const epochId = await fetchTopicContextEpochId(client, "ws_1", "topic_1");
    expectTrue(clearedAt === "2026-07-05T12:00:00.000Z");
    expectTrue(epochId === "epoch_1");
  });

  await test("fetchTopicSummary purges summary after clear with no post-clear messages", async () => {
    const clearedAt = "2026-07-05T12:00:00.000Z";
    const topicSummaries: Record<string, unknown>[] = [
      {
        id: "sum_1",
        workspace_id: "ws_1",
        topic_id: "topic_1",
        room_id: "room_1",
        summary: "Stale DM brief",
        what_happened: "Discussed funding",
        last_refreshed_at: "2026-07-05T13:30:00.000Z",
        open_questions: [{ text: "Open question" }],
        key_facts: [{ text: "Key fact" }],
        next_actions: [{ title: "Follow up" }],
        suggested_memory: [{ text: "Remember this" }],
      },
    ];
    const client = createFakeClient({
      topics: [
        {
          id: "topic_1",
          workspace_id: "ws_1",
          chat_cleared_at: clearedAt,
          metadata: {},
        },
      ],
      topicSummaries,
      messages: [],
      epochs: [],
    });

    const summary = await fetchTopicSummary(client, "ws_1", "topic_1");
    expectTrue(summary === null, "summary should be hidden after clear with no messages");
    expectTrue(topicSummaries.length === 0, "stale summary row should be deleted");
  });

  await test("fetchTopicSummary purges summary with missing last_refreshed_at after clear", async () => {
    const clearedAt = "2026-07-05T12:00:00.000Z";
    const topicSummaries: Record<string, unknown>[] = [
      {
        id: "sum_1",
        workspace_id: "ws_1",
        topic_id: "topic_1",
        room_id: "room_1",
        summary: "Brief without refresh timestamp",
        what_happened: "Discussed funding",
        open_questions: [],
        key_facts: [],
        next_actions: [],
        suggested_memory: [],
      },
    ];
    const client = createFakeClient({
      topics: [
        {
          id: "topic_1",
          workspace_id: "ws_1",
          chat_cleared_at: clearedAt,
          metadata: {},
        },
      ],
      topicSummaries,
      messages: [],
      epochs: [],
    });

    const summary = await fetchTopicSummary(client, "ws_1", "topic_1");
    expectTrue(summary === null, "summary without lastRefreshedAt should be hidden after clear");
    expectTrue(topicSummaries.length === 0, "summary row should be deleted");
  });

  console.log("\nAll clear chat context tests passed.");
}

main().catch(() => process.exit(1));
