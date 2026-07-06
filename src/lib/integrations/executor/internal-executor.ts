// ===========================================================================
// Internal executor — dispatches tool calls to AdeHQ internal adapters.
// Phase 4 adds external-executor.ts behind the same handler contract.
// ===========================================================================

import type { AdapterHandler, AdapterHandlerMap } from "@/lib/integrations/adapters/types";
import {
  createCompany,
  createContact,
  createDeal,
  listContacts,
  listDeals,
  updateDealStage,
} from "@/lib/integrations/adapters/adehq-crm";
import { createEmailDraft } from "@/lib/integrations/adapters/adehq-email";
import { createTask } from "@/lib/integrations/adapters/adehq-tasks";

const INTERNAL_HANDLERS: AdapterHandlerMap = {
  "crm.createContact": createContact as AdapterHandler,
  "crm.createCompany": createCompany as AdapterHandler,
  "crm.createDeal": createDeal as AdapterHandler,
  "crm.updateDealStage": updateDealStage as AdapterHandler,
  "crm.listContacts": listContacts as AdapterHandler,
  "crm.listDeals": listDeals as AdapterHandler,
  "email.createDraft": createEmailDraft as AdapterHandler,
  "tasks.createTask": createTask as AdapterHandler,
};

export function getInternalHandler(toolName: string): AdapterHandler | null {
  return INTERNAL_HANDLERS[toolName] ?? null;
}
