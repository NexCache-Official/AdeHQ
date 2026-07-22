import type { TemplateManifest } from "./types";
import { SOFTWARE_HOUSE_TEMPLATE } from "./software-house";
import { SAAS_STARTUP_TEMPLATE } from "./saas-startup";
import { GENERAL_OPS_TEMPLATE } from "./general-ops";

/** Template governance: the manifest registry is the code-side source of
 * truth. `workforce_studio_templates` (DB) tracks publish/deprecate state so
 * an already-approved blueprint never silently changes behavior when a
 * manifest is edited — approved blueprints freeze their own copy of
 * templateVersion + payload at approval time. */
export const TEMPLATE_REGISTRY: TemplateManifest[] = [
  SOFTWARE_HOUSE_TEMPLATE,
  SAAS_STARTUP_TEMPLATE,
  GENERAL_OPS_TEMPLATE,
];

export function getTemplateManifest(key: string): TemplateManifest | undefined {
  return TEMPLATE_REGISTRY.find((t) => t.key === key);
}

export function listTemplateManifests(): TemplateManifest[] {
  return TEMPLATE_REGISTRY;
}
