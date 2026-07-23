import type { PlaybookDefinitionV1 } from "../contracts";
import { UNIVERSAL_PLAYBOOKS } from "./universal";
import { SAAS_PLAYBOOKS } from "./saas";

export { UNIVERSAL_PLAYBOOKS } from "./universal";
export { SAAS_PLAYBOOKS } from "./saas";

export const PLATFORM_PLAYBOOK_SEEDS: PlaybookDefinitionV1[] = [
  ...UNIVERSAL_PLAYBOOKS,
  ...SAAS_PLAYBOOKS,
];

export function getPlaybookSeedByKey(key: string): PlaybookDefinitionV1 | undefined {
  return PLATFORM_PLAYBOOK_SEEDS.find((p) => p.key === key);
}
