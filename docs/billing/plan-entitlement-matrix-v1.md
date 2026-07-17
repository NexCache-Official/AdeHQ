# AdeHQ Plan Entitlement Matrix V1

**Status:** locked  
**Date:** 17 July 2026

Customer UI still shows **Auto** for intelligence. Entitlements bound Brain routing and capability gates only. Search/browser are WH-metered; there are no hidden call quotas in V1.

## Typed shape

```ts
type PlanEntitlements = {
  weeklyWh: number;
  searchEnabled: boolean;
  browserEnabled: boolean;
  voiceEnabled: boolean;
  imageEnabled: boolean;
  videoEnabled: boolean;
  videoRequiresApproval: boolean;
  maxConcurrentRuns: number;
  maxStewardCollaborators: number;
  maxStewardSteps: number;
  maxAutomaticRunWh: number;
  sharedMemoryEnabled: boolean;
  memoryRetentionDays: number | null;
  artifactStorageBytes: number;
  usageDashboardLevel: "basic" | "team" | "advanced";
  adminControlsLevel: "basic" | "standard" | "advanced";
  supportLevel: "standard" | "priority" | "dedicated";
  intelligencePolicy: "standard" | "balanced" | "advanced" | "custom";
  humanMembersUnlimited: boolean;
  aiEmployeesUnlimited: boolean;
};
```

## Matrix

| Entitlement | Free | Pro | Team | Business |
|---|---:|---:|---:|---:|
| weeklyWh | 10 | 125 | 250 | 650 |
| searchEnabled | true | true | true | true |
| browserEnabled | true | true | true | true |
| voiceEnabled | true | true | true | true |
| imageEnabled | true | true | true | true |
| videoEnabled | false | true | true | true |
| videoRequiresApproval | n/a | true | true | false |
| maxConcurrentRuns | 1 | 3 | 5 | 10 |
| maxStewardCollaborators | 0 | 2 | 4 | 8 |
| maxStewardSteps | 0 | 12 | 20 | 40 |
| maxAutomaticRunWh | 5 | 40 | 80 | 200 |
| sharedMemoryEnabled | true | true | true | true |
| memoryRetentionDays | 14 | 90 | 180 | 365 |
| artifactStorageBytes | 1 GiB | 25 GiB | 100 GiB | 500 GiB |
| usageDashboardLevel | basic | team | team | advanced |
| adminControlsLevel | basic | basic | standard | advanced |
| supportLevel | standard | standard | priority | priority |
| intelligencePolicy | standard | balanced | advanced | advanced |
| humanMembersUnlimited | true | true | true | true |
| aiEmployeesUnlimited | true | true | true | true |

## Commercial vs operational

Commercial entitlements answer “is this plan allowed to use X?”  
Operational feature flags answer “is X available right now?” (provider outage, kill switch).

Resolver must return both. Never edit customer plans to disable a broken feature.

## Enterprise / private offers

Custom entitlement JSON on invite-only, workspace-specific, or enterprise_contract plan versions. Still immutable once published.
