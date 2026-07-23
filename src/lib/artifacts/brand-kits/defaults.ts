import type { ArtifactDesignTokens } from "../contracts/design-tokens";
import { ARTIFACT_BRAND, ARTIFACT_TYPE } from "@/lib/artifacts/design-system";

export type BrandKitDefaults = {
  name: string;
  isDefault: true;
  tokens: ArtifactDesignTokens;
  footerText: string;
};

/** Default AdeHQ brand kit tokens (aligned with design-system). */
export const ADEHQ_DEFAULT_BRAND_KIT: BrandKitDefaults = {
  name: "AdeHQ Default",
  isDefault: true,
  footerText: "AdeHQ generated deliverable",
  tokens: {
    key: "adehq_default",
    name: "AdeHQ Default",
    colors: {
      ink: ARTIFACT_BRAND.ink,
      muted: ARTIFACT_BRAND.muted,
      accent: ARTIFACT_BRAND.accent,
      pale: ARTIFACT_BRAND.pale,
      border: ARTIFACT_BRAND.border,
      background: ARTIFACT_BRAND.white,
      headerFill: ARTIFACT_BRAND.headerFill,
    },
    typography: {
      display: ARTIFACT_TYPE.display,
      body: ARTIFACT_TYPE.body,
    },
    document: { pageMarginPt: 54 },
    presentation: { accentBar: true, footerBrand: true },
    spreadsheet: { headerFill: ARTIFACT_BRAND.accent, headerText: "FFFFFF" },
  },
};
