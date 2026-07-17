/**
 * Workspace access invariants — pure decision tests (no live DB).
 * Run: npx tsx scripts/test-workspace-access-invariants.ts
 */
import {
  assertEffectiveAiScope,
  canAccessAiEmployee,
  canAccessMaya,
  canAccessRoom,
  canAccessTopic,
  canDmAiEmployee,
  canManageAiEmployees,
  canSendInRoom,
  humanDmPairKey,
  isAiDmNavigable,
  selectDmOwner,
} from "../src/lib/workspace/access";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run(name: string, fn: () => void): Promise<void> {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const admin = { userId: "user-admin", role: "admin" as const };
const member = { userId: "user-member", role: "member" as const };
const other = { userId: "user-other", role: "member" as const };

const maya = {
  id: "emp-maya",
  employeeKind: "system_manager" as const,
  employeeAccess: "restricted" as const,
  isSystemManager: true,
};

const wren = {
  id: "emp-wren",
  employeeKind: "workspace_employee" as const,
  employeeAccess: "workspace" as const,
};

const finance = {
  id: "emp-finance",
  employeeKind: "workspace_employee" as const,
  employeeAccess: "restricted" as const,
};

async function main() {
  await run("humanDmPairKey is canonical and commutative", () => {
    assert(humanDmPairKey("b", "a") === humanDmPairKey("a", "b"), "pair key must match");
    assert(humanDmPairKey("a", "b") === "a:b", "smaller first");
  });

  await run("Maya and hire are admin-only", () => {
    assert(canAccessMaya("admin"), "admin maya");
    assert(!canAccessMaya("member"), "member no maya");
    assert(canManageAiEmployees("admin"), "admin hire");
    assert(!canManageAiEmployees("member"), "member no hire");
    assert(canAccessAiEmployee({ actor: admin, employee: maya }), "admin accesses maya");
    assert(!canAccessAiEmployee({ actor: member, employee: maya }), "member cannot access maya");
  });

  await run("workspace AI default allow; deny wins", () => {
    assert(canAccessAiEmployee({ actor: member, employee: wren }), "default allow");
    assert(
      !canAccessAiEmployee({
        actor: member,
        employee: wren,
        grant: {
          workspaceId: "ws",
          userId: member.userId,
          employeeId: wren.id,
          accessEffect: "deny",
          canDm: true,
          canAssignWork: true,
          canViewSharedOutputs: true,
        },
      }),
      "deny wins",
    );
  });

  await run("restricted AI requires allow grant", () => {
    assert(!canAccessAiEmployee({ actor: member, employee: finance }), "no grant");
    assert(
      canAccessAiEmployee({
        actor: member,
        employee: finance,
        grant: {
          workspaceId: "ws",
          userId: member.userId,
          employeeId: finance.id,
          accessEffect: "allow",
          canDm: true,
          canAssignWork: true,
          canViewSharedOutputs: true,
        },
      }),
      "allow grant",
    );
  });

  await run("AI DM access is owner-only; admin has no bypass", () => {
    const adminDm = {
      kind: "dm",
      visibility: "private" as const,
      dmOwnerUserId: admin.userId,
      dmEmployeeId: wren.id,
      isRoomMember: false,
    };
    assert(canAccessRoom({ actor: admin, room: adminDm }), "owner");
    assert(!canAccessRoom({ actor: member, room: adminDm }), "other member");
    assert(!canAccessRoom({ actor: other, room: adminDm }), "other");
    // Even admin cannot open member's DM
    const memberDm = {
      kind: "dm",
      visibility: "private" as const,
      dmOwnerUserId: member.userId,
      dmEmployeeId: wren.id,
      isRoomMember: true,
    };
    assert(!canAccessRoom({ actor: admin, room: memberDm }), "admin no DM bypass");
  });

  await run("human DM allows both peers only", () => {
    const room = {
      kind: "dm",
      visibility: "private" as const,
      dmOwnerUserId: "aaa",
      dmPeerUserId: "zzz",
      isRoomMember: true,
    };
    assert(canAccessRoom({ actor: { userId: "aaa", role: "member" }, room }), "owner");
    assert(canAccessRoom({ actor: { userId: "zzz", role: "admin" }, room }), "peer");
    assert(!canAccessRoom({ actor: { userId: "mid", role: "admin" }, room }), "outsider admin");
  });

  await run("workspace rooms authorize without room_members", () => {
    const room = {
      kind: "room",
      visibility: "workspace" as const,
      isRoomMember: false,
    };
    assert(canAccessRoom({ actor: member, room }), "member without membership row");
  });

  await run("restricted/private rooms require membership even for admins", () => {
    const privateRoom = {
      kind: "room",
      visibility: "private" as const,
      isRoomMember: false,
    };
    assert(!canAccessRoom({ actor: admin, room: privateRoom }), "admin needs membership");
    assert(
      canAccessRoom({ actor: admin, room: { ...privateRoom, isRoomMember: true } }),
      "admin with membership",
    );
  });

  await run("topic deny-only narrows", () => {
    const room = { kind: "room", visibility: "workspace" as const, isRoomMember: false };
    assert(canAccessTopic({ actor: member, topic: { room, topicDenied: false } }), "inherited");
    assert(!canAccessTopic({ actor: member, topic: { room, topicDenied: true } }), "denied");
  });

  await run("revoke hides AI DM navigation but identity retained conceptually", () => {
    const grantDeny = {
      workspaceId: "ws",
      userId: member.userId,
      employeeId: wren.id,
      accessEffect: "deny" as const,
      canDm: false,
      canAssignWork: false,
      canViewSharedOutputs: false,
    };
    assert(
      !isAiDmNavigable({
        actor: member,
        employee: wren,
        grant: grantDeny,
        dmOwnerUserId: member.userId,
      }),
      "hidden after revoke",
    );
    assert(
      !canSendInRoom({
        actor: member,
        room: {
          kind: "dm",
          visibility: "private",
          dmOwnerUserId: member.userId,
          dmEmployeeId: wren.id,
          isRoomMember: true,
        },
        aiEmployee: wren,
        grant: grantDeny,
      }),
      "cannot send after revoke",
    );
    assert(
      isAiDmNavigable({
        actor: member,
        employee: wren,
        grant: null,
        dmOwnerUserId: member.userId,
      }),
      "re-grant (default allow) restores nav",
    );
  });

  await run("effective AI scope intersection", () => {
    const ok = assertEffectiveAiScope({
      actor: member,
      employee: wren,
      room: {
        kind: "dm",
        visibility: "private",
        dmOwnerUserId: member.userId,
        dmEmployeeId: wren.id,
        isRoomMember: true,
      },
    });
    assert(ok.ok, "owner scope ok");

    const leak = assertEffectiveAiScope({
      actor: member,
      employee: wren,
      room: {
        kind: "dm",
        visibility: "private",
        dmOwnerUserId: admin.userId,
        dmEmployeeId: wren.id,
        isRoomMember: false,
      },
    });
    assert(!leak.ok && leak.reason === "no_room_access", "cannot use other human DM");

    const topicBlock = assertEffectiveAiScope({
      actor: member,
      employee: wren,
      room: { kind: "room", visibility: "workspace", isRoomMember: false },
      topicDenied: true,
    });
    assert(!topicBlock.ok && topicBlock.reason === "topic_denied", "topic deny");
  });

  await run("DM ownership heuristic prefers highest human sender", () => {
    const picked = selectDmOwner({
      humanSenderCounts: [
        { userId: "u1", count: 2, earliestAt: "2020-01-01" },
        { userId: "u2", count: 10, earliestAt: "2020-06-01" },
      ],
      humanMembers: [
        { userId: "u1", joinedAt: "2019-01-01" },
        { userId: "u2", joinedAt: "2020-01-01" },
      ],
      adminUserIds: ["admin"],
    });
    assert(picked.ownerId === "u2", "highest count");
    assert(picked.reason === "highest_human_sender", "reason");
  });

  await run("canDmAiEmployee respects can_dm flag on allow grant", () => {
    assert(
      !canDmAiEmployee({
        actor: member,
        employee: finance,
        grant: {
          workspaceId: "ws",
          userId: member.userId,
          employeeId: finance.id,
          accessEffect: "allow",
          canDm: false,
          canAssignWork: true,
          canViewSharedOutputs: true,
        },
      }),
      "allow without can_dm",
    );
  });

  console.log("\nAll workspace access invariant tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
