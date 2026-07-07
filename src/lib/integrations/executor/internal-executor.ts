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
import {
  createCampaign,
  createContentPost,
  draftPost,
  scheduleDraft,
} from "@/lib/integrations/adapters/adehq-content";
import { createEmailDraft } from "@/lib/integrations/adapters/adehq-email";
import {
  createFirm,
  createFollowUp,
  createInvestorContact,
  scoreFit,
  updatePipeline,
} from "@/lib/integrations/adapters/adehq-investors";
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
  "social.createCampaign": createCampaign as AdapterHandler,
  "calendar.createCampaign": createCampaign as AdapterHandler,
  "social.draftPost": draftPost as AdapterHandler,
  "calendar.createContentPost": createContentPost as AdapterHandler,
  "calendar.scheduleDraft": scheduleDraft as AdapterHandler,
  "investor.createFirm": createFirm as AdapterHandler,
  "investor.createInvestorContact": createInvestorContact as AdapterHandler,
  "investor.updatePipeline": updatePipeline as AdapterHandler,
  "investor.scoreFit": scoreFit as AdapterHandler,
  "investor.createFollowUp": createFollowUp as AdapterHandler,
};

export function getInternalHandler(toolName: string): AdapterHandler | null {
  return INTERNAL_HANDLERS[toolName] ?? null;
}
