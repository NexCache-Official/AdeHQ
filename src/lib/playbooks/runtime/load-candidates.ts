import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaybookRoleCandidate } from "@/lib/playbooks/contracts";

type AiEmployeeRow = {
  id: string;
  name?: string | null;
  role?: string | null;
  role_key?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  instructions?: string | null;
};

/** Map workspace employee role keys onto playbook role/capability tags. */
const ROLE_KEY_TAGS: Record<string, { roleTags: string[]; capabilityTags: string[] }> = {
  research: {
    roleTags: ["researcher", "analyst", "research"],
    capabilityTags: ["search", "reasoning", "research"],
  },
  pm: {
    roleTags: ["analyst", "strategist", "pm", "writer"],
    capabilityTags: ["reasoning", "writing", "review"],
  },
  engineering: {
    roleTags: ["engineer", "engineering", "analyst"],
    capabilityTags: ["reasoning", "writing"],
  },
  design: {
    roleTags: ["designer", "design", "writer"],
    capabilityTags: ["writing", "review"],
  },
  marketing: {
    roleTags: ["writer", "marketer", "marketing", "strategist"],
    capabilityTags: ["writing", "search", "reasoning"],
  },
  fundraising: {
    roleTags: ["strategist", "writer", "fundraising"],
    capabilityTags: ["writing", "reasoning", "review"],
  },
  gamedev: {
    roleTags: ["engineer", "designer", "writer"],
    capabilityTags: ["reasoning", "writing"],
  },
  operations: {
    roleTags: ["ops", "operations", "analyst", "reviewer"],
    capabilityTags: ["reasoning", "review"],
  },
  sales: {
    roleTags: ["sales", "strategist", "writer"],
    capabilityTags: ["writing", "reasoning", "search"],
  },
  support: {
    roleTags: ["support", "reviewer", "writer"],
    capabilityTags: ["review", "writing"],
  },
  recruiting_manager: {
    roleTags: ["recruiter", "reviewer", "writer"],
    capabilityTags: ["review", "writing", "reasoning"],
  },
};

function uniqLower(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Convert an ai_employees row into a PlaybookRoleCandidate with real tags.
 * Never invents employee IDs — only enriches tags for matching.
 */
export function employeeRowToPlaybookCandidate(row: AiEmployeeRow): PlaybookRoleCandidate {
  const roleKey = String(row.role_key ?? "").trim().toLowerCase();
  const roleLabel = String(row.role ?? "").trim().toLowerCase();
  const mapped = ROLE_KEY_TAGS[roleKey] ?? { roleTags: [], capabilityTags: [] };

  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const metaRoleTags = Array.isArray(meta.roleTags)
    ? meta.roleTags.map(String)
    : Array.isArray(meta.role_tags)
      ? meta.role_tags.map(String)
      : [];
  const metaCapTags = Array.isArray(meta.capabilityTags)
    ? meta.capabilityTags.map(String)
    : Array.isArray(meta.capability_tags)
      ? meta.capability_tags.map(String)
      : [];

  const purpose = typeof meta.purpose === "string" ? meta.purpose : "";
  const purposeTags = purpose
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    employeeId: String(row.id),
    roleTags: uniqLower([
      roleKey,
      roleLabel,
      ...mapped.roleTags,
      ...metaRoleTags,
      ...purposeTags,
    ]),
    capabilityTags: uniqLower([...mapped.capabilityTags, ...metaCapTags]),
  };
}

/**
 * Load AI employees for a workspace and map them to playbook role candidates.
 * Follows the standard `ai_employees` workspace roster pattern.
 */
export async function loadPlaybookRoleCandidates(
  client: SupabaseClient,
  opts: {
    workspaceId: string;
    /** When set, only these employee IDs are returned (still with real tags). */
    employeeIds?: string[];
  },
): Promise<PlaybookRoleCandidate[]> {
  let q = client
    .from("ai_employees")
    .select("id, name, role, role_key, status, metadata, instructions")
    .eq("workspace_id", opts.workspaceId);

  if (opts.employeeIds?.length) {
    q = q.in("id", opts.employeeIds);
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as AiEmployeeRow[];
  return rows
    .filter((row) => {
      const status = String(row.status ?? "active").toLowerCase();
      return status !== "archived" && status !== "disabled" && status !== "deleted";
    })
    .map(employeeRowToPlaybookCandidate);
}
