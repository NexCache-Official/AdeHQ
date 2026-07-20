import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_PROMPT_TOKENS = 180;
const MAX_TERMS = 32;

function cleanTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\r\n,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 64) return null;
  return clean;
}

function boundedPrompt(terms: string[], maxTokens: number): string {
  const unique = [...new Set(terms.map(cleanTerm).filter((v): v is string => Boolean(v)))];
  const prefix = "Use these spellings for names and specialist terms: ";
  const maxChars = Math.max(80, Math.min(maxTokens, MAX_PROMPT_TOKENS) * 4);
  let output = prefix;
  for (const term of unique.slice(0, MAX_TERMS)) {
    const candidate = `${output}${output === prefix ? "" : ", "}${term}`;
    if (candidate.length > maxChars) break;
    output = candidate;
  }
  return output === prefix ? "" : `${output}.`;
}

/**
 * Builds a small, permission-scoped spelling lexicon. It intentionally avoids
 * messages and memory so general workspace context never leaves AdeHQ as STT hints.
 */
export async function buildCallVocabulary(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    conversationId: string;
    humanUserId: string;
    employeeId: string;
    maxTokens?: number;
  },
): Promise<string> {
  const [workspace, employee, human, roomMembers] = await Promise.all([
    client
      .from("workspaces")
      .select("name")
      .eq("id", input.workspaceId)
      .maybeSingle(),
    client
      .from("ai_employees")
      .select("name, role")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.employeeId)
      .maybeSingle(),
    client.from("profiles").select("name").eq("id", input.humanUserId).maybeSingle(),
    client
      .from("room_members")
      .select("member_type, member_id")
      .eq("workspace_id", input.workspaceId)
      .eq("room_id", input.conversationId)
      .limit(20),
  ]);

  const permittedHumanIds = (roomMembers.data ?? [])
    .filter((row) => row.member_type === "human")
    .map((row) => String(row.member_id))
    .filter((id) => id !== input.humanUserId);
  const permittedEmployeeIds = (roomMembers.data ?? [])
    .filter((row) => row.member_type === "ai")
    .map((row) => String(row.member_id))
    .filter((id) => id !== input.employeeId);

  const [humans, employees] = await Promise.all([
    permittedHumanIds.length
      ? client.from("profiles").select("name").in("id", permittedHumanIds)
      : Promise.resolve({ data: [] as Array<{ name: string }> }),
    permittedEmployeeIds.length
      ? client
          .from("ai_employees")
          .select("name, role")
          .eq("workspace_id", input.workspaceId)
          .in("id", permittedEmployeeIds)
      : Promise.resolve({ data: [] as Array<{ name: string; role: string }> }),
  ]);

  return boundedPrompt(
    [
      workspace.data?.name,
      employee.data?.name,
      employee.data?.role,
      human.data?.name,
      ...(humans.data ?? []).map((row) => row.name),
      ...(employees.data ?? []).flatMap((row) => [row.name, row.role]),
      "AdeHQ",
      "Work Hours",
      "TypeScript",
      "Supabase",
      "Vercel",
    ].filter((value): value is string => typeof value === "string"),
    input.maxTokens ?? MAX_PROMPT_TOKENS,
  );
}
