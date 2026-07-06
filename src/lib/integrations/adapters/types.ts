// ===========================================================================
// Adapter contract — internal providers now, external providers in Phase 4.
// The executor calls adapters through this interface only, so swapping
// AdeHQ CRM for HubSpot never touches prompts or the executor.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";

export type AdapterHandler<Args = Record<string, unknown>> = (
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: Args,
) => Promise<ToolExecutionOutput>;

/** Maps fully-qualified tool names to their executing adapter handler. */
export type AdapterHandlerMap = Record<string, AdapterHandler>;
