import {
  CATALOG_VERSION,
  DECISION_VERSION,
  PACKET_VERSION,
  ROUTER_VERSION,
} from "@/lib/brain/catalog/version";
import {
  isBrainImageV1Enabled,
  isBrainSearchV1Enabled,
  isBrainV1Enabled,
  isBrainVideoV1Enabled,
  isBrainVisionV1Enabled,
  isBrainStewardV1Enabled,
  isBrainVoiceV1Enabled,
} from "@/lib/brain/flags";
import { RELEASE_MANIFEST, type ReleaseManifest } from "@/lib/release/manifest";

export type BuildEnvironment = "local" | "preview" | "production";

export type BuildInformation = {
  gitCommit: string;
  builtAt: string;
  environment: BuildEnvironment;
  appVersion: string;
  catalogVersion: number;
  packetVersion: string;
  decisionVersion: string;
  routerVersion: string;
  migrationVersion: string;
  enabledFeatures: {
    brainV1: boolean;
    searchV1: boolean;
    visionV1: boolean;
    imageV1: boolean;
    videoV1: boolean;
    voiceV1: boolean;
    stewardV1: boolean;
  };
  release: ReleaseManifest;
  mismatches: string[];
};

function resolveEnvironment(): BuildEnvironment {
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) return "production";
  return "local";
}

function resolveGitCommit(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    "unknown"
  );
}

function resolveBuiltAt(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_TIMESTAMP?.trim() ||
    process.env.BUILD_TIMESTAMP?.trim() ||
    new Date().toISOString()
  );
}

/** Latest required migration version string for this release. */
export const REQUIRED_MIGRATION_VERSION = RELEASE_MANIFEST.requiredMigrationVersion;

export function getBuildInformation(opts?: {
  migrationVersion?: string | null;
}): BuildInformation {
  const enabledFeatures = {
    brainV1: isBrainV1Enabled(),
    searchV1: isBrainSearchV1Enabled(),
    visionV1: isBrainVisionV1Enabled(),
    imageV1: isBrainImageV1Enabled(),
    videoV1: isBrainVideoV1Enabled(),
    voiceV1: isBrainVoiceV1Enabled(),
    stewardV1: isBrainStewardV1Enabled(),
  };

  const migrationVersion = opts?.migrationVersion ?? REQUIRED_MIGRATION_VERSION;
  const mismatches: string[] = [];

  if (Number(CATALOG_VERSION) !== RELEASE_MANIFEST.catalogVersion) {
    mismatches.push(
      `catalogVersion runtime=${CATALOG_VERSION} manifest=${RELEASE_MANIFEST.catalogVersion}`,
    );
  }

  for (const [key, expected] of Object.entries(RELEASE_MANIFEST.expectedFeatures)) {
    const actual = enabledFeatures[key as keyof typeof enabledFeatures];
    if (actual !== expected) {
      mismatches.push(`feature ${key}: runtime=${actual} expected=${expected}`);
    }
  }

  return {
    gitCommit: resolveGitCommit(),
    builtAt: resolveBuiltAt(),
    environment: resolveEnvironment(),
    appVersion: RELEASE_MANIFEST.appVersion,
    catalogVersion: Number(CATALOG_VERSION),
    packetVersion: PACKET_VERSION,
    decisionVersion: DECISION_VERSION,
    routerVersion: ROUTER_VERSION,
    migrationVersion,
    enabledFeatures,
    release: RELEASE_MANIFEST,
    mismatches,
  };
}
