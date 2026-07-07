import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { putSecret, getSecret, sha256Fingerprint } from "@/lib/security/secrets/store";
import { resolveProviderCredential, clearProviderCredentialCache } from "@/lib/providers/credentials/resolve-provider-credential";
import { recordCostEvent } from "@/lib/billing/costing/record-cost-event";

type Row = Record<string, any>;

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private insertRows: Row[] | null = null;
  private patch: Row | null = null;
  private selectColumns = "*";

  constructor(private tables: Record<string, Row[]>, private table: string) {}

  select(columns = "*") { this.selectColumns = columns; return this; }
  order() { return this; }
  limit() { return this; }
  eq(key: string, value: any) { this.filters.push((row) => row[key] === value); return this; }
  neq(key: string, value: any) { this.filters.push((row) => row[key] !== value); return this; }
  gte(key: string, value: any) { this.filters.push((row) => String(row[key] ?? "") >= String(value)); return this; }
  in(key: string, values: any[]) { this.filters.push((row) => values.includes(row[key])); return this; }
  insert(rows: Row | Row[]) {
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    this.tables[this.table] ??= [];
    for (const row of this.insertRows) this.tables[this.table].push({ id: row.id ?? `id_${this.tables[this.table].length + 1}`, ...row });
    return this;
  }
  update(patch: Row) { this.patch = patch; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    const incoming = Array.isArray(rows) ? rows : [rows];
    this.tables[this.table] ??= [];
    const keys = opts?.onConflict?.split(",") ?? ["id"];
    for (const row of incoming) {
      const existing = this.tables[this.table].find((current) => keys.every((key) => current[key] === row[key]));
      if (existing) {
        if (!opts?.ignoreDuplicates) Object.assign(existing, row);
      } else {
        this.tables[this.table].push({ id: row.id ?? `id_${this.tables[this.table].length + 1}`, ...row });
      }
    }
    return this;
  }
  private rows(): Row[] {
    this.tables[this.table] ??= [];
    let rows = this.tables[this.table].filter((row) => this.filters.every((fn) => fn(row)));
    if (this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
    }
    return rows;
  }
  async maybeSingle() { return { data: this.rows()[0] ?? null, error: null }; }
  async single() { return { data: this.rows()[0] ?? this.insertRows?.[0] ?? null, error: null }; }
  then(resolve: (value: { data: Row[]; error: null }) => void) {
    resolve({ data: this.rows(), error: null });
  }
}

function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  return { from: (table: string) => new Query(tables, table) } as unknown as SupabaseClient;
}

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearProviderCredentialCache();
  }
}

async function run(name: string, fn: () => Promise<void> | void) {
  await fn();
  console.log(`✓ ${name}`);
}

function seedCredential(tables: Record<string, Row[]>, id: string, provider = "siliconflow", key = `key-${id}`) {
  const stored = putSecret(key);
  tables.platform_provider_credentials.push({
    id,
    provider,
    label: id,
    scope: "global_pool",
    secret_ref: stored.secretRef,
    key_last4: stored.last4,
    key_fingerprint_sha256: stored.fingerprint,
    encryption_key_version: stored.keyVersion,
    status: "active",
    created_at: new Date().toISOString(),
  });
  return stored;
}

async function main() {
  await withEnv(
    {
      ADEHQ_SECRET_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      ADEHQ_SECRET_ENCRYPTION_KEY_VERSION: "1",
      ALLOW_PROVIDER_ENV_FALLBACK: "true",
      SILICONFLOW_API_KEY: "env-sf",
    },
    async () => {
      await run("encryption round-trip stores last4 and fingerprint", () => {
        const stored = putSecret("secret-value-1234");
        assert.equal(getSecret(stored.secretRef), "secret-value-1234");
        assert.equal(stored.last4, "1234");
        assert.equal(stored.fingerprint, sha256Fingerprint("secret-value-1234"));
      });

      await run("workspace resolves active global pool credential", async () => {
        const tables = { platform_provider_credentials: [], workspace_provider_allocations: [], ai_cost_ledger_entries: [], platform_provider_credential_events: [] } as Record<string, Row[]>;
        seedCredential(tables, "cred_pool", "siliconflow", "pool-key");
        const resolved = await resolveProviderCredential({ workspaceId: "ws1", provider: "siliconflow", client: fakeClient(tables), skipCache: true });
        assert.equal(resolved.credentialId, "cred_pool");
        assert.equal(resolved.apiKey, "pool-key");
      });

      await run("dedicated workspace credential overrides global pool", async () => {
        const tables = { platform_provider_credentials: [], workspace_provider_allocations: [], ai_cost_ledger_entries: [], platform_provider_credential_events: [] } as Record<string, Row[]>;
        seedCredential(tables, "global", "siliconflow", "global-key");
        seedCredential(tables, "dedicated", "siliconflow", "dedicated-key");
        tables.workspace_provider_allocations.push({ id: "alloc1", workspace_id: "ws1", provider: "siliconflow", credential_id: "dedicated", status: "active", allocation_type: "dedicated_key" });
        const resolved = await resolveProviderCredential({ workspaceId: "ws1", provider: "siliconflow", client: fakeClient(tables), skipCache: true });
        assert.equal(resolved.credentialId, "dedicated");
        assert.equal(resolved.allocationId, "alloc1");
      });

      await run("disabled credential is skipped", async () => {
        const tables = { platform_provider_credentials: [], workspace_provider_allocations: [], ai_cost_ledger_entries: [], platform_provider_credential_events: [] } as Record<string, Row[]>;
        seedCredential(tables, "disabled", "siliconflow", "bad-key");
        tables.platform_provider_credentials[0].status = "disabled";
        const resolved = await resolveProviderCredential({ workspaceId: "ws1", provider: "siliconflow", client: fakeClient(tables), skipCache: true });
        assert.equal(resolved.source, "env_fallback");
      });

      await run("over-budget credential skips to env fallback", async () => {
        const tables = { platform_provider_credentials: [], workspace_provider_allocations: [], ai_cost_ledger_entries: [], platform_provider_credential_events: [] } as Record<string, Row[]>;
        seedCredential(tables, "limited", "siliconflow", "limited-key");
        tables.platform_provider_credentials[0].daily_limit_requests = 1;
        tables.ai_cost_ledger_entries.push({ provider_credential_id: "limited", created_at: new Date().toISOString(), actual_cost_usd: 0.01, status: "succeeded" });
        const resolved = await resolveProviderCredential({ workspaceId: "ws1", provider: "siliconflow", client: fakeClient(tables), skipCache: true });
        assert.equal(resolved.source, "env_fallback");
        assert(tables.platform_provider_credential_events.some((e) => e.event_type === "budget_exceeded"));
      });

      await run("env fallback can be refused", async () => {
        await withEnv({ ALLOW_PROVIDER_ENV_FALLBACK: "false" }, async () => {
          const tables = { platform_provider_credentials: [], workspace_provider_allocations: [], ai_cost_ledger_entries: [], platform_provider_credential_events: [] } as Record<string, Row[]>;
          await assert.rejects(
            () => resolveProviderCredential({ workspaceId: "ws1", provider: "siliconflow", client: fakeClient(tables), skipCache: true }),
            /No usable siliconflow credential/,
          );
        });
      });

      await run("duplicate fingerprint can be detected", () => {
        assert.equal(putSecret("same-key").fingerprint, putSecret("same-key").fingerprint);
      });

      await run("credential id recorded on cost ledger payload", async () => {
        const tables = { ai_cost_ledger_entries: [] } as Record<string, Row[]>;
        await recordCostEvent(fakeClient(tables), {
          workspaceId: "00000000-0000-0000-0000-000000000001",
          sourceType: "llm",
          providerCredentialId: "11111111-1111-1111-1111-111111111111",
          actualCostUsd: 0.01,
        });
        assert.equal(tables.ai_cost_ledger_entries[0].provider_credential_id, "11111111-1111-1111-1111-111111111111");
      });
    },
  );

  console.log("\nAll provider credential tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
