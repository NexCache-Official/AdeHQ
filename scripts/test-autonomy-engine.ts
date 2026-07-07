/**
 * Autonomy engine smoke tests (no live DB, no provider).
 *
 * Drives the plan → act → observe → report loop against an in-memory fake
 * Supabase client, a scripted brain, and a stubbed tool runner. Covers the
 * happy path, the step budget guardrail, approval pause + resume, and stop.
 */
import {
  driveSession,
  resumeIfApprovalResolved,
  runSessionIteration,
} from "../src/lib/autonomy/engine";
import { requestStop as controlStop } from "../src/lib/autonomy/controls";
import { createSession, getSession, listSteps, updateSession } from "../src/lib/autonomy/session-store";
import type { AutonomyBrain, AutonomyDecision } from "../src/lib/autonomy/types";
import type { ToolCallResult } from "../src/lib/integrations/types";

// ---------------------------------------------------------------------------
// Minimal in-memory Supabase fake — supports only the chained calls the engine
// uses: insert/upsert/update/select + eq/in/is/order/limit + single/maybeSingle
// + thenable await (array form).
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function uuid(): string {
  return "id-" + Math.random().toString(36).slice(2, 10);
}

class Query {
  private filters: Array<[string, string, any]> = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private onConflict?: string;
  private orderCol?: string;
  private orderAsc = true;
  private limitN?: number;

  constructor(private tables: Record<string, Row[]>, private table: string) {}

  private rows(): Row[] {
    return (this.tables[this.table] ??= []);
  }

  insert(payload: Row | Row[]) { this.op = "insert"; this.payload = payload; return this; }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert"; this.payload = payload; this.onConflict = opts?.onConflict; return this;
  }
  update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
  select(_cols?: string) { if (this.op === "select") this.payload = null; return this; }
  eq(col: string, val: any) { this.filters.push([col, "eq", val]); return this; }
  in(col: string, vals: any[]) { this.filters.push([col, "in", vals]); return this; }
  is(col: string, val: any) { this.filters.push([col, "is", val]); return this; }
  ilike(col: string, val: any) { this.filters.push([col, "ilike", val]); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderCol = col; this.orderAsc = opts?.ascending ?? true; return this; }
  limit(n: number) { this.limitN = n; return this; }

  private match(row: Row): boolean {
    return this.filters.every(([col, kind, val]) => {
      if (kind === "eq") return row[col] === val;
      if (kind === "in") return (val as any[]).includes(row[col]);
      if (kind === "is") return row[col] === val;
      if (kind === "ilike") return String(row[col] ?? "").toLowerCase().includes(String(val).toLowerCase().replace(/%/g, ""));
      return true;
    });
  }

  private run(): { data: Row[]; error: null } {
    const store = this.rows();
    if (this.op === "insert" || this.op === "upsert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const inserted: Row[] = [];
      for (const raw of incoming) {
        const row: Row = { ...raw };
        if (row.id == null) row.id = uuid();
        if (row.created_at == null) row.created_at = new Date().toISOString();
        if (row.updated_at == null) row.updated_at = row.created_at;
        if (this.op === "upsert" && this.onConflict) {
          const keys = this.onConflict.split(",").map((k) => k.trim());
          const existing = store.find((r) => keys.every((k) => r[k] === row[k]));
          if (existing) { Object.assign(existing, row); inserted.push(existing); continue; }
        }
        store.push(row);
        inserted.push(row);
      }
      return { data: inserted, error: null };
    }
    if (this.op === "update") {
      const matched = store.filter((r) => this.match(r));
      for (const r of matched) Object.assign(r, this.payload, { updated_at: new Date().toISOString() });
      return { data: matched, error: null };
    }
    // select
    let matched = store.filter((r) => this.match(r));
    if (this.orderCol) {
      const col = this.orderCol;
      matched = [...matched].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0));
      if (!this.orderAsc) matched.reverse();
    }
    if (this.limitN != null) matched = matched.slice(0, this.limitN);
    return { data: matched, error: null };
  }

  async single() { const { data } = this.run(); return { data: data[0] ?? null, error: data.length ? null : { code: "PGRST116" } }; }
  async maybeSingle() { const { data } = this.run(); return { data: data[0] ?? null, error: null }; }
  then(resolve: (v: { data: Row[]; error: null }) => any) { return Promise.resolve(this.run()).then(resolve); }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  from(table: string) { return new Query(this.tables, table) as any; }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function run(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { failures += 1; console.error(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

function seedWorkspace(client: FakeClient, opts?: { taskId?: string }) {
  client.tables.ai_employees = [
    { workspace_id: "ws1", id: "emp1", name: "Nova Sales", role: "Senior Sales Rep", role_key: "sales" },
  ];
  client.tables.employee_tools = [
    { workspace_id: "ws1", employee_id: "emp1", tool_id: "adehq-crm", status: "connected", permission: "write" },
  ];
  client.tables.tasks = opts?.taskId
    ? [{ workspace_id: "ws1", id: opts.taskId, room_id: "room1", topic_id: "t1", title: "Do it", status: "open" }]
    : [];
  client.tables.messages = [];
  client.tables.integration_tool_runs = [];
  client.tables.approvals = [];
  client.tables.autonomous_sessions = [];
  client.tables.autonomous_session_steps = [];
}

function successRunner(summary: string): (...args: any[]) => Promise<ToolCallResult> {
  return async (_client, _ctx, request) => ({
    status: "success",
    tool: request.tool,
    mode: "execute",
    toolRunId: uuid(),
    costUsd: 0,
    workMinutes: 0,
    output: { summary, payload: {} },
    messageArtifacts: [],
  });
}

function scriptedBrain(decisions: AutonomyDecision[]): AutonomyBrain {
  let i = 0;
  return async () => decisions[Math.min(i++, decisions.length - 1)];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  await run("happy path: plan → act → observe → done, task marked done, report posted", async () => {
    const client = new FakeClient();
    seedWorkspace(client, { taskId: "task1" });
    const session = await createSession(client as any, {
      workspaceId: "ws1", employeeId: "emp1", objective: "Add Neil as a lead", roomId: "room1", topicId: "t1", taskId: "task1", stepBudget: 5,
    });
    const brain = scriptedBrain([
      { thought: "Create the contact", status: "continue", plan: ["Add contact", "Wrap up"], toolCalls: [{ tool: "crm.createContact", mode: "execute", args: { firstName: "Neil" } }] },
      { thought: "All done", status: "done", toolCalls: [], report: "Added Neil to the CRM." },
    ]);
    const final = await driveSession(client as any, session.id, brain, 10, { runTool: successRunner("Created contact Neil") });
    assert(final?.status === "completed", `expected completed, got ${final?.status}`);
    assert((final?.resultSummary ?? "").includes("Neil"), "report should mention Neil");
    const steps = await listSteps(client as any, session.id);
    const kinds = steps.map((s) => s.kind);
    assert(kinds.includes("plan"), "has plan step");
    assert(kinds.includes("thought"), "has thought step");
    assert(kinds.includes("tool_call"), "has tool_call step");
    assert(kinds.includes("observation"), "has observation step");
    assert(kinds.includes("report"), "has report step");
    const task = client.tables.tasks.find((t) => t.id === "task1");
    assert(task?.status === "done", "linked task marked done");
    assert(client.tables.messages.length === 1, "posted a report message to the room");
    assert(final!.stepsUsed >= 1, "consumed at least one step");
  });

  await run("step budget guardrail stops the loop", async () => {
    const client = new FakeClient();
    seedWorkspace(client);
    const session = await createSession(client as any, {
      workspaceId: "ws1", employeeId: "emp1", objective: "Loop forever", stepBudget: 2,
    });
    // Brain always wants to continue with a tool call.
    const brain = scriptedBrain([
      { thought: "step", status: "continue", toolCalls: [{ tool: "crm.createContact", mode: "execute", args: { firstName: "X" } }] },
    ]);
    const final = await driveSession(client as any, session.id, brain, 50, { runTool: successRunner("ok") });
    assert(final?.status === "completed", `budget-hit should finalize completed, got ${final?.status}`);
    assert(final!.stepsUsed <= 2, `steps capped at budget, got ${final!.stepsUsed}`);
    assert((final?.resultSummary ?? "").toLowerCase().includes("budget"), "report notes the budget");
  });

  await run("approval-gated tool pauses, then resumes after approval", async () => {
    const client = new FakeClient();
    seedWorkspace(client);
    const session = await createSession(client as any, {
      workspaceId: "ws1", employeeId: "emp1", objective: "Send external email", stepBudget: 5,
    });
    let call = 0;
    const brain: AutonomyBrain = async () => {
      call += 1;
      if (call === 1) return { thought: "Needs approval", status: "continue", toolCalls: [{ tool: "email.createDraft", mode: "preview", args: { subject: "Hi", body: "..." } }] };
      return { thought: "Approved, finishing", status: "done", toolCalls: [], report: "Sent after approval." };
    };
    const approvalRunner: (...a: any[]) => Promise<ToolCallResult> = async (_c, _ctx, request) => ({
      status: "approval_pending", tool: request.tool, mode: "preview", approvalId: "appr1", toolRunId: uuid(),
      costUsd: 0, workMinutes: 0, preview: { title: "Send email", summary: "Approve to send", fields: [], risk: "medium" }, messageArtifacts: [],
    });

    let s = await driveSession(client as any, session.id, brain, 10, { runTool: approvalRunner });
    assert(s?.status === "waiting_approval", `expected waiting_approval, got ${s?.status}`);
    assert(s?.pendingApprovalId === "appr1", "pending approval id recorded");

    // Human approves via the approvals table.
    client.tables.approvals.push({ workspace_id: "ws1", id: "appr1", status: "approved" });
    const resumed = await resumeIfApprovalResolved(client as any, session.id);
    assert(resumed?.status === "queued", `expected queued after approval, got ${resumed?.status}`);

    s = await driveSession(client as any, session.id, brain, 10, { runTool: approvalRunner });
    assert(s?.status === "completed", `expected completed after resume, got ${s?.status}`);
    const steps = await listSteps(client as any, session.id);
    assert(steps.some((x) => x.kind === "approval" && x.metadata.resolved), "recorded approval resolution");
  });

  await run("stop request finalizes as stopped", async () => {
    const client = new FakeClient();
    seedWorkspace(client);
    const session = await createSession(client as any, {
      workspaceId: "ws1", employeeId: "emp1", objective: "Long job", stepBudget: 5,
    });
    // Queued session: stop marks it stopped immediately.
    const stopped = await controlStop(client as any, session.id);
    assert(stopped?.status === "stopped", `expected stopped, got ${stopped?.status}`);
  });

  await run("mid-run stop is honored on the next iteration", async () => {
    const client = new FakeClient();
    seedWorkspace(client);
    const session = await createSession(client as any, {
      workspaceId: "ws1", employeeId: "emp1", objective: "Long job", stepBudget: 5,
    });
    await updateSession(client as any, session.id, { status: "running", stopRequested: true });
    const outcome = await runSessionIteration(
      client as any, session.id,
      scriptedBrain([{ thought: "x", status: "continue", toolCalls: [] }]),
      { runTool: successRunner("ok") },
    );
    assert(outcome.status === "stopped", `expected stopped, got ${outcome.status}`);
    const s = await getSession(client as any, session.id);
    assert(s?.status === "stopped", "session persisted stopped");
  });

  if (failures > 0) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log("\nAll autonomy engine tests passed.");
}

void main();
