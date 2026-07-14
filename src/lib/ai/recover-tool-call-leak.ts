import type { ToolCallEffect } from "@/lib/integrations/types";
import { coerceToolCall } from "@/lib/integrations/coerce-tool-args";

/**
 * Some models invent a faux DSL when they want tools but the turn has no
 * structured effects channel (or they ignore the JSON schema):
 *
 *   [TOOL_CALL]
 *   {tool => "artifact.createSpreadsheet", args => {
 *     --title "…"
 *     --rows [[…]]
 *   }}
 *   [/TOOL_CALL]
 *
 * Recover executable tool calls from that text so Drive/CRM work still runs,
 * then the caller should strip the leak from the visible reply.
 */
export function recoverToolCallsFromLeakedReply(reply: string): ToolCallEffect[] {
  if (!reply || !/\[TOOL_CALL\]/i.test(reply)) return [];

  const blocks = [...reply.matchAll(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/gi)];
  const openOnly =
    blocks.length === 0 && /\[TOOL_CALL\]/i.test(reply)
      ? [reply.split(/\[TOOL_CALL\]/i).slice(1).join("[TOOL_CALL]")]
      : [];

  const bodies = blocks.length ? blocks.map((m) => m[1] ?? "") : openOnly;
  const recovered: ToolCallEffect[] = [];

  for (const body of bodies) {
    const tool =
      body.match(/tool\s*=>\s*["']([^"']+)["']/i)?.[1] ??
      body.match(/"tool"\s*:\s*"([^"]+)"/i)?.[1];
    if (!tool || !tool.includes(".")) continue;

    const args: Record<string, unknown> = {};
    const flagRe =
      /--([a-zA-Z]\w*)\s+("(?:\\.|[^"\\])*"|\[(?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*\]|-?\d+(?:\.\d+)?|true|false|null)/g;
    for (const match of body.matchAll(flagRe)) {
      const key = match[1];
      const raw = match[2];
      args[key] = parseFlagValue(raw);
    }

    // JSON args object fallback: args: { ... } / "args": { ... }
    if (Object.keys(args).length === 0) {
      const jsonArgs = body.match(/"args"\s*:\s*(\{[\s\S]*\})/i)?.[1];
      if (jsonArgs) {
        try {
          const parsed = JSON.parse(jsonArgs) as Record<string, unknown>;
          Object.assign(args, parsed);
        } catch {
          // keep empty — coerce may still fill defaults
        }
      }
    }

    recovered.push(coerceToolCall(tool, { tool, mode: "execute", args }));
  }

  return recovered.filter((call) => call.tool.includes("."));
}

function parseFlagValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{") ||
    /^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
