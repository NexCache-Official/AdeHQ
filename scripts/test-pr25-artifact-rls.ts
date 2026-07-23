/**
 * PR-25 — artifact access / private DM inheritance rules as pure assertions (no DB).
 */
import { canViewArtifactScope } from "../src/lib/artifacts/api-access";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-25 artifact RLS / access helpers ===\n");

check(
  "creator always can view private DM artifact",
  canViewArtifactScope({
    isWorkspaceMember: true,
    isArtifactCreator: true,
    roomId: "dm_1",
    isPrivateDmRoom: true,
    isRoomParticipant: false,
  }),
);

check(
  "private DM: non-participant workspace member denied",
  !canViewArtifactScope({
    isWorkspaceMember: true,
    isArtifactCreator: false,
    roomId: "dm_1",
    isPrivateDmRoom: true,
    isRoomParticipant: false,
  }),
);

check(
  "private DM: participant allowed",
  canViewArtifactScope({
    isWorkspaceMember: true,
    isArtifactCreator: false,
    roomId: "dm_1",
    isPrivateDmRoom: true,
    isRoomParticipant: true,
  }),
);

check(
  "room artifact: participant allowed",
  canViewArtifactScope({
    isWorkspaceMember: true,
    isArtifactCreator: false,
    roomId: "room_1",
    isPrivateDmRoom: false,
    isRoomParticipant: true,
  }),
);

check(
  "room artifact: non-participant denied",
  !canViewArtifactScope({
    isWorkspaceMember: true,
    isArtifactCreator: false,
    roomId: "room_1",
    isPrivateDmRoom: false,
    isRoomParticipant: false,
  }),
);

check(
  "workspace-scoped (no room) member allowed",
  canViewArtifactScope({
    isWorkspaceMember: true,
    isArtifactCreator: false,
    roomId: null,
    isPrivateDmRoom: false,
    isRoomParticipant: false,
    shareScope: "workspace",
  }),
);

check(
  "non-member denied for workspace scope",
  !canViewArtifactScope({
    isWorkspaceMember: false,
    isArtifactCreator: false,
    roomId: null,
    isPrivateDmRoom: false,
    isRoomParticipant: false,
    shareScope: "workspace",
  }),
);

check(
  "shareScope private: only creator",
  !canViewArtifactScope({
    isWorkspaceMember: true,
    isArtifactCreator: false,
    roomId: null,
    isPrivateDmRoom: false,
    isRoomParticipant: false,
    shareScope: "private",
  }) &&
    canViewArtifactScope({
      isWorkspaceMember: false,
      isArtifactCreator: true,
      roomId: null,
      isPrivateDmRoom: false,
      isRoomParticipant: false,
      shareScope: "private",
    }),
);

console.log(`\n${failed ? `Failed: ${failed}` : "All artifact RLS helper checks passed."}\n`);
process.exit(failed ? 1 : 0);
