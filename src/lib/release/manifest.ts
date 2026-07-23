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
    pr19Steward: string;
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
    /** PR-19 collaborative execution rollout state. */
    stewardV1: boolean;
    /** PR-25 playbook runtime — default OFF. */
    playbookRuntimeV1: boolean;
    /** PR-25 artifact runtime — default OFF. */
    artifactRuntimeV1: boolean;
    /** PR-25 procedure backpack — default OFF. */
    procedureRuntimeV1: boolean;
  };
  notes: string[];
};

export const RELEASE_MANIFEST: ReleaseManifest = {
  releaseId: "baseline-pr25-playbook-artifact-runtime",
  appVersion: "20.2.0",
  catalogVersion: 8,
  requiredMigrationVersion: "20260723200000",
  baselineCommits: {
    pr14Search: "49b8c5a444624d2152e833aeac9baa95ae283f9c",
    pr15Vision: "3ea98a1ef6b7458cbaf1c8d4839a043ce371e463",
    pr16Image: "e71bb14d6f147d1eca94ad2a557096bb6061c59c",
    pr17Video: "2e8a0657cd147e0b57ed5c53c329813130cf9a65",
    pr19Steward: "29ca1f96301b677c1f30264dd877b4a9fec47faf",
    privateDmsHybridAccess: "66e9bd3853b658f7c03c8957e61953a6c556cbba",
    profileAvatars: "2e8f90ab83f996c8d29c2bbaa0f74c5ad385bd18",
  },
  expectedFeatures: {
    brainV1: true,
    searchV1: true,
    visionV1: true,
    imageV1: true,
    videoV1: true,
    voiceV1: true,
    stewardV1: true,
    playbookRuntimeV1: false,
    artifactRuntimeV1: false,
    procedureRuntimeV1: false,
  },
  notes: [
    "PR-25 Playbook / Artifact / Procedure runtime ships behind flags (default OFF): ADEHQ_PLAYBOOK_RUNTIME_V1, ADEHQ_ARTIFACT_RUNTIME_V1, ADEHQ_PROCEDURE_RUNTIME_V1.",
    "PR-25 migration 20260723200000 adds playbook/procedure tables and structured artifact columns; customer surfaces stay gated until flags are enabled.",
    "PR-19 Steward collaborative execution is live; ADEHQ_BRAIN_STEWARD_V1 remains the production kill switch.",
    "PR-19 media collaboration routes ideation/review findings to exactly one terminal image or video creator.",
    "PR-18.1 Realtime Brain Calls alpha: ADEHQ_LIVE_CALLS_V1=1 with Groq STT + SiliconFlow/xAI TTS.",
    "Billing: Revolut-only; plan terms migration 20260717192753.",
    "Production human QA requires /api/build-info to match this manifest.",
  ],
};
