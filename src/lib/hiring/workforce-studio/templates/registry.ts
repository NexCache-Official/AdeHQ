import type { TemplateManifest } from "./types";
import { SOFTWARE_HOUSE_TEMPLATE } from "./software-house";
import { SAAS_STARTUP_TEMPLATE } from "./saas-startup";
import { GENERAL_OPS_TEMPLATE } from "./general-ops";
import { listOntologyManifests, type ManifestWithCategory } from "../ontology/registry";
import type { PackCategory } from "../ontology/types";

/** Legacy packs kept for composition-test parity + stable tech/ops graphs. */
const LEGACY_MANIFESTS: Array<TemplateManifest & { category: PackCategory }> = [
  { ...SOFTWARE_HOUSE_TEMPLATE, category: "technology" },
  { ...SAAS_STARTUP_TEMPLATE, category: "technology" },
  { ...GENERAL_OPS_TEMPLATE, category: "operational" },
];

/** Template governance: registry is the code-side source of truth.
 * Includes PR-21 legacy packs + PR-22B ontology-compiled curated packs. */
export const TEMPLATE_REGISTRY: Array<TemplateManifest & { category?: PackCategory }> = [
  ...LEGACY_MANIFESTS,
  ...listOntologyManifests(),
];

export function getTemplateManifest(key: string): TemplateManifest | undefined {
  return TEMPLATE_REGISTRY.find((t) => t.key === key);
}

export function listTemplateManifests(): TemplateManifest[] {
  return TEMPLATE_REGISTRY;
}

export function listTemplateManifestsWithCategory(): Array<TemplateManifest & { category: PackCategory }> {
  return TEMPLATE_REGISTRY.map((t) => ({
    ...t,
    category: (t as ManifestWithCategory).category ?? "operational",
  }));
}
