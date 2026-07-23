import type { PlaybookDefinitionV1 } from "./contracts";
import { estimatePlaybookWh } from "./estimator";
import { PLATFORM_PLAYBOOK_SEEDS, getPlaybookSeedByKey } from "./seeds";

export const SEED_PLAYBOOK_ID_PREFIX = "seed:";

export function isSeedPlaybookId(playbookId: string): boolean {
  return playbookId.startsWith(SEED_PLAYBOOK_ID_PREFIX);
}

export function seedKeyFromPlaybookId(playbookId: string): string {
  return playbookId.slice(SEED_PLAYBOOK_ID_PREFIX.length);
}

export function seedPlaybookId(key: string): string {
  return `${SEED_PLAYBOOK_ID_PREFIX}${key}`;
}

export type PlaybookListItem = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  industryTags: string[];
  visibility: string;
  status: string;
  source: "seed" | "database";
  estimatedWhMin: number | null;
  estimatedWhMax: number | null;
  stepCount: number;
  roleCount: number;
  definition?: PlaybookDefinitionV1;
};

export function catalogItemFromSeed(def: PlaybookDefinitionV1): PlaybookListItem {
  const estimate = estimatePlaybookWh(def);
  return {
    id: seedPlaybookId(def.key),
    key: def.key,
    name: def.name,
    description: def.description ?? null,
    category: def.category,
    industryTags: def.industryTags ?? [],
    visibility: def.visibility ?? "platform",
    status: def.status ?? "published",
    source: "seed",
    estimatedWhMin: estimate.estimatedWhMin,
    estimatedWhMax: estimate.estimatedWhMax,
    stepCount: def.steps.length,
    roleCount: def.roleRequirements.length,
    definition: def,
  };
}

export function listPublishedSeedCatalog(): PlaybookListItem[] {
  return PLATFORM_PLAYBOOK_SEEDS.filter(
    (p) => (p.status ?? "published") === "published",
  ).map(catalogItemFromSeed);
}

export function resolveSeedDefinition(
  playbookIdOrKey: string,
): PlaybookDefinitionV1 | undefined {
  if (isSeedPlaybookId(playbookIdOrKey)) {
    return getPlaybookSeedByKey(seedKeyFromPlaybookId(playbookIdOrKey));
  }
  return getPlaybookSeedByKey(playbookIdOrKey);
}
