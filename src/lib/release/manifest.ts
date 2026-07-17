/**
 * Authoritative release manifest for AdeHQ Brain + hybrid access baseline.
 * Update when shipping a gated capability or bumping required migration/catalog.
 */

export type ReleaseManifest = {
  releaseId: string;
  appVersion: string;
  catalogVersion: number;
  requiredMigrationVersion: string;
  baselineCommits: {
    pr14Search: string;
    pr15Vision: string;
    pr16Image: string;
    pr17Video: string;
    privateDmsHybridAccess: string;
    profileAvatars: string;
  };
  expectedFeatures: {
    brainV1: boolean;
    searchV1: boolean;
    visionV1: boolean;
    imageV1: boolean;
    videoV1: boolean;
    /** Off until ADEHQ_BRAIN_VOICE_V1=1 in the target environment. */
    voiceV1: boolean;
    /** Off until PR-19 execution mode; shadow may flip separately. */
    stewardV1: boolean;
  };
  notes: string[];
};

export const RELEASE_MANIFEST: ReleaseManifest = {
  releaseId: "baseline-pr11-17-hybrid-access",
  appVersion: "20.1.5",
  catalogVersion: 7,
  requiredMigrationVersion: "20260717192753",
  baselineCommits: {
    pr14Search: "49b8c5a444624d2152e833aeac9baa95ae283f9c",
    pr15Vision: "3ea98a1ef6b7458cbaf1c8d4839a043ce371e463",
    pr16Image: "e71bb14d6f147d1eca94ad2a557096bb6061c59c",
    pr17Video: "2e8a0657cd147e0b57ed5c53c329813130cf9a65",
    privateDmsHybridAccess: "66e9bd3853b658f7c03c8957e61953a6c556cbba",
    profileAvatars: "2e8f90ab83f996c8d29c2bbaa0f74c5ad385bd18",
  },
  expectedFeatures: {
    brainV1: true,
    searchV1: true,
    visionV1: true,
    imageV1: true,
    videoV1: true,
    voiceV1: false,
    stewardV1: false,
  },
  notes: [
    "PR-19 Steward shadow plans via ADEHQ_BRAIN_STEWARD_SHADOW=1 (no execution until stewardV1).",
    "PR-19 execution builds on PR-17.5 reliability before PR-18 Voice.",
    "Deploy with ADEHQ_BRAIN_STEWARD_V1=0 and ADEHQ_BRAIN_VOICE_V1=0 until workspace rollout.",
    "Billing: Revolut-only; plan terms migration 20260717192753.",
    "Production human QA requires /api/build-info to match this manifest.",
  ],
};
