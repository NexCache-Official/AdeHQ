/**
 * Team coordination smoke tests (no live DB, no provider).
 *
 * Covers shared-room resolution (group rooms only, never DMs), topic-hint
 * targeting, the "no shared room" path, and the one-hop loop guard — using an
 * in-memory fake Supabase client. The queue/process side is skipped when the
 * service-role env is absent (resolveSharedRoom is the pure, testable core).
 */
import { resolveSharedRoom, coordinateWithColleague } from "../src/lib/server/team-coordination";

type Row = Record<string, any>;

class Query {
  private filters: Array<[string, string, any]> = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private orderCol?: string;
  private orderAsc = true;
  private limitN?: number;
  constructor(private tables: Record<string, Row[]>, private table: string) {}
  private rows() { return (this.tables[this.table] ??= []); }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  upsert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  select() { return this; }
  eq(c: string, v: any) { this.filters.push([c, "eq", v]); return this; }
  neq(c: string, v: any) { this.filters.push([c, "neq", v]); return this; }
  in(c: string, v: any[]) { this.filters.push([c, "in", v]); return this; }
  ilike(c: string, v: any) { this.filters.push([c, "ilike", v]); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orderCol = c; this.orderAsc = o?.ascending ?? true; return this; }
  limit(n: number) { this.limitN = n; return this; }
  private match(r: Row) {
    return this.filters.every(([c, k, v]) => {
      if (k === "eq") return r[c] === v;
      if (k === "neq") return r[c] !== v;
      if (k === "in") return (v as any[]).includes(r[c]);
      if (k === "ilike") return String(r[c] ?? "").toLowerCase().includes(String(v).toLowerCase().replace(/%/g, ""));
      return true;
    });
  }
  private run() {
    const store = this.rows();
    if (this.op === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
      for (const r of incoming) store.push({ ...r });
      return { data: incoming, error: null };
    }
    if (this.op === "update") {
      const matched = store.filter((r) => this.match(r));
      for (const r of matched) Object.assign(r, this.payload);
      return { data: matched, error: null };
    }
    let matched = store.filter((r) => this.match(r));
    if (this.orderCol) {
      const c = this.orderCol;
      matched = [...matched].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0));
      if (!this.orderAsc) matched.reverse();
    }
    if (this.limitN != null) matched = matched.slice(0, this.limitN);
    return { data: matched, error: null };
  }
  async single() { const { data } = this.run(); return { data: data[0] ?? null, error: data.length ? null : { code: "PGRST116" } }; }
  async maybeSingle() { const { data } = this.run(); return { data: data[0] ?? null, error: null }; }
  then(res: (v: { data: Row[]; error: null }) => any) { return Promise.resolve(this.run()).then(res); }
}
class FakeClient {
  tables: Record<string, Row[]> = {};
  from(t: string) { return new Query(this.tables, t) as any; }
}

let failures = 0;
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
async function run(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failures += 1; console.error(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

function seed(client: FakeClient) {
  client.tables.rooms = [
    { workspace_id: "ws1", id: "roomA", name: "Product", kind: "room", status: "active", updated_at: "2026-01-02" },
    { workspace_id: "ws1", id: "roomB", name: "Growth", kind: "room", status: "active", updated_at: "2026-01-05" },
    { workspace_id: "ws1", id: "dmX", name: "DM", kind: "dm", status: "active", updated_at: "2026-01-09" },
  ];
  client.tables.room_members = [
    { workspace_id: "ws1", room_id: "roomA", member_type: "ai", member_id: "emp1" },
    { workspace_id: "ws1", room_id: "roomA", member_type: "ai", member_id: "emp2" },
    { workspace_id: "ws1", room_id: "roomB", member_type: "ai", member_id: "emp1" },
    { workspace_id: "ws1", room_id: "roomB", member_type: "ai", member_id: "emp2" },
    { workspace_id: "ws1", room_id: "dmX", member_type: "ai", member_id: "emp1" },
    { workspace_id: "ws1", room_id: "dmX", member_type: "ai", member_id: "emp2" },
  ];
  client.tables.topics = [
    { workspace_id: "ws1", room_id: "roomB", id: "tGen", title: "General", status: "active", metadata: { isMainChat: true } },
    { workspace_id: "ws1", room_id: "roomB", id: "tPricing", title: "Pricing strategy", status: "active", metadata: {} },
  ];
  client.tables.ai_employees = [
    { workspace_id: "ws1", id: "emp1", name: "Alex Chen", role: "PM", provider: "mock", model: "m", model_mode: "balanced" },
    { workspace_id: "ws1", id: "emp2", name: "Priya Nair", role: "Researcher", provider: "mock", model: "m", model_mode: "balanced" },
  ];
  client.tables.messages = [];
  client.tables.agent_runs = [];
}

async function main() {
  await run("resolveSharedRoom prefers the most recently active shared GROUP room", async () => {
    const client = new FakeClient();
    seed(client);
    const shared = await resolveSharedRoom(client as any, "ws1", "emp1", "emp2");
    assert(shared !== null, "should find a shared room");
    assert(shared!.roomId === "roomB", `expected roomB (most recent), got ${shared!.roomId}`);
    assert(shared!.roomName === "Growth", "room name resolved");
  });

  await run("resolveSharedRoom never returns a DM", async () => {
    const client = new FakeClient();
    seed(client);
    // Make the DM the most recent — it must still be excluded.
    const shared = await resolveSharedRoom(client as any, "ws1", "emp1", "emp2");
    assert(shared!.roomId !== "dmX", "must not pick the DM");
  });

  await run("topic hint lands in a matching existing topic", async () => {
    const client = new FakeClient();
    seed(client);
    const shared = await resolveSharedRoom(client as any, "ws1", "emp1", "emp2", { topicHint: "pricing" });
    assert(shared!.topicId === "tPricing", `expected tPricing, got ${shared!.topicId}`);
    assert(shared!.topicTitle === "Pricing strategy", "topic title resolved");
  });

  await run("no shared room → null", async () => {
    const client = new FakeClient();
    seed(client);
    // emp3 shares nothing.
    const shared = await resolveSharedRoom(client as any, "ws1", "emp1", "emp3");
    assert(shared === null, "should be null when no shared room");
  });

  await run("coordinate loop guard blocks a run already spawned by coordination", async () => {
    const client = new FakeClient();
    seed(client);
    client.tables.agent_runs = [{ workspace_id: "ws1", id: "run1", run_metadata: { coordinationDepth: 1 } }];
    const result = await coordinateWithColleague(client as any, {
      workspaceId: "ws1",
      sourceEmployeeId: "emp1",
      sourceEmployeeName: "Alex Chen",
      targetEmployeeName: "Priya Nair",
      message: "let's sync",
      currentAgentRunId: "run1",
    });
    assert(result.ok === false, "should refuse when already coordinating");
    assert(/coordination thread/i.test(result.reason ?? ""), "explains the loop guard");
  });

  await run("coordinate reports 'no shared room' cleanly", async () => {
    const client = new FakeClient();
    seed(client);
    client.tables.ai_employees.push({ workspace_id: "ws1", id: "emp3", name: "Sam Solo", role: "Ops", provider: "mock", model: "m", model_mode: "balanced" });
    const result = await coordinateWithColleague(client as any, {
      workspaceId: "ws1",
      sourceEmployeeId: "emp1",
      sourceEmployeeName: "Alex Chen",
      targetEmployeeName: "Sam Solo",
      message: "help?",
    });
    assert(result.ok === false, "no shared room → not ok");
    assert(/shared room/i.test(result.reason ?? ""), "explains the missing shared room");
  });

  if (failures > 0) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log("\nAll team coordination tests passed.");
}

void main();
