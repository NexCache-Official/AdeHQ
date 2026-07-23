import { compilePackToManifest } from "./compile-pack";
import { listCuratedPacks } from "./packs";
import type { CuratedPack, PackCategory } from "./types";
import type { TemplateManifest } from "../templates/types";

export type ManifestWithCategory = TemplateManifest & { category: PackCategory };

const COMPILED: ManifestWithCategory[] = listCuratedPacks().map((pack) => ({
  ...compilePackToManifest(pack),
  category: pack.category,
}));

export function listOntologyManifests(): ManifestWithCategory[] {
  return COMPILED;
}

export function getOntologyManifest(key: string): ManifestWithCategory | undefined {
  return COMPILED.find((m) => m.key === key);
}

export function getCuratedPackMeta(key: string): CuratedPack | undefined {
  return listCuratedPacks().find((p) => p.key === key || p.aliases?.includes(key));
}

export function listPacksByCategory(): Record<PackCategory, ManifestWithCategory[]> {
  const out: Record<PackCategory, ManifestWithCategory[]> = {
    commerce: [],
    hospitality: [],
    professional: [],
    technology: [],
    education_media: [],
    operational: [],
  };
  for (const m of COMPILED) out[m.category].push(m);
  return out;
}
