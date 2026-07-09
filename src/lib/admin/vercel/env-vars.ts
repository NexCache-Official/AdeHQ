import { getVercelConfig, vercelApiFetch, type VercelConfig, type VercelEnvTarget } from "./client";

export type VercelEnvType = "plain" | "encrypted" | "sensitive" | "secret" | "system";

/** Safe env row for the admin UI — never includes decrypted secret values. */
export type SafeVercelEnvRow = {
  id: string;
  key: string;
  type: VercelEnvType;
  target: VercelEnvTarget[];
  gitBranch: string | null;
  comment: string | null;
  system: boolean;
  integrationManaged: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  /** Masked placeholder when a value exists but is not shown. */
  valuePreview: string;
};

type RawVercelEnv = {
  id?: string;
  key?: string;
  type?: string;
  target?: VercelEnvTarget[] | VercelEnvTarget;
  gitBranch?: string | null;
  comment?: string | null;
  system?: boolean;
  configurationId?: string | null;
  createdAt?: number;
  updatedAt?: number;
  value?: string;
};

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_LENGTH = 64_000;
const MAX_COMMENT_LENGTH = 500;

/** Keys that require typing the key name again before delete. */
export const PROTECTED_ENV_KEYS = new Set([
  "VERCEL_API_TOKEN",
  "VERCEL_ACCESS_TOKEN",
  "SUPABASE_SECRET_KEY",
  "PLATFORM_SUPER_ADMIN_EMAIL",
  "REVOLUT_MERCHANT_API_KEY",
  "REVOLUT_WEBHOOK_SECRET",
]);

export function isVercelEnvConfigured(): boolean {
  return getVercelConfig() != null;
}

function normalizeTargets(target: RawVercelEnv["target"]): VercelEnvTarget[] {
  if (!target) return [];
  return Array.isArray(target) ? target : [target];
}

function maskValue(type: string | undefined, value: string | undefined): string {
  if (!value) return "—";
  if (type === "system") return "(system)";
  if (value.startsWith("enc:") || value.includes("•")) return value;
  return "••••••••";
}

function sanitizeRow(raw: RawVercelEnv): SafeVercelEnvRow | null {
  if (!raw.id || !raw.key) return null;
  const type = (raw.type ?? "encrypted") as VercelEnvType;
  return {
    id: raw.id,
    key: raw.key,
    type,
    target: normalizeTargets(raw.target),
    gitBranch: raw.gitBranch ?? null,
    comment: raw.comment ?? null,
    system: Boolean(raw.system),
    integrationManaged: Boolean(raw.configurationId),
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    valuePreview: maskValue(raw.type, raw.value),
  };
}

function projectPath(config: VercelConfig): string {
  return `/v10/projects/${encodeURIComponent(config.projectIdOrName)}/env`;
}

/** List env vars without decryption — secrets stay masked. */
export async function listVercelEnvVars(): Promise<{
  configured: boolean;
  projectIdOrName: string | null;
  envs: SafeVercelEnvRow[];
  hiddenProductionEnvCount?: number;
}> {
  const config = getVercelConfig();
  if (!config) {
    return { configured: false, projectIdOrName: null, envs: [] };
  }

  const data = await vercelApiFetch<{ envs?: RawVercelEnv[]; hiddenProductionEnvCount?: number }>(
    config,
    `${projectPath(config)}?decrypt=false`,
  );

  const envs = (data.envs ?? [])
    .map(sanitizeRow)
    .filter((row): row is SafeVercelEnvRow => row != null)
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    configured: true,
    projectIdOrName: config.projectIdOrName,
    envs,
    hiddenProductionEnvCount: data.hiddenProductionEnvCount,
  };
}

export function validateEnvKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "Key is required.";
  if (trimmed.length > MAX_KEY_LENGTH) return `Key must be at most ${MAX_KEY_LENGTH} characters.`;
  if (!ENV_KEY_PATTERN.test(trimmed)) {
    return "Key must use UPPER_SNAKE_CASE (letters, numbers, underscores; start with a letter).";
  }
  return null;
}

export function validateEnvValue(value: string): string | null {
  if (!value) return "Value is required.";
  if (value.length > MAX_VALUE_LENGTH) return `Value must be at most ${MAX_VALUE_LENGTH} characters.`;
  return null;
}

export function validateTargets(targets: VercelEnvTarget[]): string | null {
  if (!targets.length) return "Select at least one environment target.";
  return null;
}

export type UpsertVercelEnvInput = {
  key: string;
  value: string;
  type?: "plain" | "encrypted" | "sensitive";
  target: VercelEnvTarget[];
  gitBranch?: string | null;
  comment?: string | null;
};

export async function createVercelEnvVar(input: UpsertVercelEnvInput): Promise<SafeVercelEnvRow> {
  const config = getVercelConfig();
  if (!config) throw new Error("Vercel API is not configured on this deployment.");

  const keyErr = validateEnvKey(input.key);
  if (keyErr) throw new Error(keyErr);
  const valueErr = validateEnvValue(input.value);
  if (valueErr) throw new Error(valueErr);
  const targetErr = validateTargets(input.target);
  if (targetErr) throw new Error(targetErr);

  const type = input.type ?? (input.key.startsWith("NEXT_PUBLIC_") ? "plain" : "sensitive");
  const comment = input.comment?.trim().slice(0, MAX_COMMENT_LENGTH) || undefined;

  const data = await vercelApiFetch<RawVercelEnv | { created?: RawVercelEnv }>(
    config,
    `${projectPath(config)}?upsert=false`,
    {
      method: "POST",
      body: JSON.stringify({
        key: input.key.trim(),
        value: input.value,
        type,
        target: input.target,
        gitBranch: input.gitBranch || undefined,
        comment,
      }),
    },
  );

  const created = "created" in data && data.created ? data.created : data;
  const row = sanitizeRow(created as RawVercelEnv);
  if (!row) throw new Error("Vercel created the variable but returned an unexpected response.");
  return row;
}

export type UpdateVercelEnvInput = {
  key?: string;
  value?: string;
  type?: "plain" | "encrypted" | "sensitive";
  target?: VercelEnvTarget[];
  gitBranch?: string | null;
  comment?: string | null;
};

export async function updateVercelEnvVar(
  envId: string,
  input: UpdateVercelEnvInput,
): Promise<SafeVercelEnvRow> {
  const config = getVercelConfig();
  if (!config) throw new Error("Vercel API is not configured on this deployment.");

  const patch: Record<string, unknown> = {};
  if (input.key != null) {
    const keyErr = validateEnvKey(input.key);
    if (keyErr) throw new Error(keyErr);
    patch.key = input.key.trim();
  }
  if (input.value != null) {
    const valueErr = validateEnvValue(input.value);
    if (valueErr) throw new Error(valueErr);
    patch.value = input.value;
  }
  if (input.type) patch.type = input.type;
  if (input.target) {
    const targetErr = validateTargets(input.target);
    if (targetErr) throw new Error(targetErr);
    patch.target = input.target;
  }
  if (input.gitBranch !== undefined) patch.gitBranch = input.gitBranch;
  if (input.comment !== undefined) {
    patch.comment = input.comment?.trim().slice(0, MAX_COMMENT_LENGTH) || null;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No changes provided.");
  }

  const data = await vercelApiFetch<RawVercelEnv>(
    config,
    `/v9/projects/${encodeURIComponent(config.projectIdOrName)}/env/${encodeURIComponent(envId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );

  const row = sanitizeRow(data);
  if (!row) throw new Error("Vercel updated the variable but returned an unexpected response.");
  return row;
}

export async function deleteVercelEnvVar(envId: string): Promise<void> {
  const config = getVercelConfig();
  if (!config) throw new Error("Vercel API is not configured on this deployment.");

  await vercelApiFetch<unknown>(
    config,
    `/v9/projects/${encodeURIComponent(config.projectIdOrName)}/env/${encodeURIComponent(envId)}`,
    { method: "DELETE" },
  );
}

export function assertEnvMutable(row: SafeVercelEnvRow): void {
  if (row.system) throw new Error(`System variable "${row.key}" cannot be changed from AdeHQ Control.`);
  if (row.integrationManaged) {
    throw new Error(`"${row.key}" is managed by a Vercel integration — change it in the Vercel dashboard.`);
  }
}
