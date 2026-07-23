import type { ArtifactDesignTokens } from "../contracts/design-tokens";

export type PlatformArtifactTemplate = {
  key: string;
  name: string;
  description: string;
  tokens: ArtifactDesignTokens;
  suitedFor: Array<"document" | "presentation" | "workbook" | "report">;
};

const baseTypography = {
  display: "Aptos Display",
  body: "Aptos",
  mono: "ui-monospace",
};

export const PLATFORM_ARTIFACT_TEMPLATES: PlatformArtifactTemplate[] = [
  {
    key: "adehq_onyx",
    name: "AdeHQ Onyx",
    description: "Default AdeHQ teal accent on near-ink surfaces.",
    suitedFor: ["document", "presentation", "workbook", "report"],
    tokens: {
      key: "adehq_onyx",
      name: "AdeHQ Onyx",
      colors: {
        ink: "111827",
        muted: "6B7280",
        accent: "0F766E",
        pale: "F0FDFA",
        border: "E5E7EB",
        background: "FFFFFF",
        headerFill: "111827",
      },
      typography: baseTypography,
      document: { pageMarginPt: 54, headingScale: 1 },
      presentation: { accentBar: true, footerBrand: true },
      spreadsheet: { headerFill: "0F766E", headerText: "FFFFFF" },
    },
  },
  {
    key: "executive_minimal",
    name: "Executive Minimal",
    description: "Quiet charcoal typography for leadership memos.",
    suitedFor: ["document", "report"],
    tokens: {
      key: "executive_minimal",
      name: "Executive Minimal",
      colors: {
        ink: "1F2937",
        muted: "6B7280",
        accent: "374151",
        pale: "F9FAFB",
        border: "E5E7EB",
        background: "FFFFFF",
        headerFill: "1F2937",
      },
      typography: { display: "Georgia", body: "Aptos", mono: "ui-monospace" },
      document: { pageMarginPt: 64, headingScale: 0.95 },
      presentation: { accentBar: false, footerBrand: true },
      spreadsheet: { headerFill: "374151", headerText: "FFFFFF" },
    },
  },
  {
    key: "editorial_report",
    name: "Editorial Report",
    description: "Long-form research reports with strong section hierarchy.",
    suitedFor: ["document", "report"],
    tokens: {
      key: "editorial_report",
      name: "Editorial Report",
      colors: {
        ink: "0F172A",
        muted: "64748B",
        accent: "0E7490",
        pale: "ECFEFF",
        border: "CBD5E1",
        background: "FFFFFF",
        headerFill: "0F172A",
      },
      typography: { display: "Iowan Old Style", body: "Aptos", mono: "ui-monospace" },
      document: { pageMarginPt: 58, headingScale: 1.05 },
      presentation: { accentBar: true, footerBrand: true },
      spreadsheet: { headerFill: "0E7490", headerText: "FFFFFF" },
    },
  },
  {
    key: "business_proposal",
    name: "Business Proposal",
    description: "Proposal-ready layout with confident accent bars.",
    suitedFor: ["document", "presentation"],
    tokens: {
      key: "business_proposal",
      name: "Business Proposal",
      colors: {
        ink: "111827",
        muted: "4B5563",
        accent: "115E59",
        pale: "F0FDFA",
        border: "D1D5DB",
        background: "FFFFFF",
        headerFill: "115E59",
      },
      typography: baseTypography,
      document: { pageMarginPt: 54, headingScale: 1 },
      presentation: { accentBar: true, footerBrand: true },
      spreadsheet: { headerFill: "115E59", headerText: "FFFFFF" },
    },
  },
  {
    key: "bold_presentation",
    name: "Bold Presentation",
    description: "High-contrast deck template for campaign and MBR slides.",
    suitedFor: ["presentation"],
    tokens: {
      key: "bold_presentation",
      name: "Bold Presentation",
      colors: {
        ink: "0B1220",
        muted: "94A3B8",
        accent: "F59E0B",
        pale: "FFFBEB",
        border: "E2E8F0",
        background: "0B1220",
        headerFill: "0B1220",
      },
      typography: { display: "Aptos Display", body: "Aptos", mono: "ui-monospace" },
      document: { pageMarginPt: 48, headingScale: 1.1 },
      presentation: { accentBar: true, footerBrand: true },
      spreadsheet: { headerFill: "F59E0B", headerText: "0B1220" },
    },
  },
];

export function getPlatformTemplate(key: string): PlatformArtifactTemplate | undefined {
  return PLATFORM_ARTIFACT_TEMPLATES.find((t) => t.key === key);
}
