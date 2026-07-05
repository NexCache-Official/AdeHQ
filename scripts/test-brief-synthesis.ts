import assert from "node:assert/strict";
import {
  buildSynthesisInput,
  missionNeedsRefresh,
  synthesizeMission,
} from "../src/lib/hiring/brief-synthesis";

const marketingInput = buildSynthesisInput(
  {
    roleTitle: "Content Marketing Manager",
    department: "Marketing",
    domain: "B2B SaaS",
    businessFocus: ["Content campaigns", "Launch messaging"],
    technicalFocus: [],
    coreResponsibilities: [],
  },
  ["I need someone for launch campaigns and blog content"],
  null,
  null,
);

assert.equal(
  missionNeedsRefresh("Improve latency, bandwidth efficiency, and runtime performance for software engineering workloads.", marketingInput),
  true,
);

const marketingMission = synthesizeMission(marketingInput);
assert.match(marketingMission, /content campaigns/i);
assert.doesNotMatch(marketingMission, /latency|bandwidth/i);

const legalInput = buildSynthesisInput(
  {
    roleTitle: "Legal Review Specialist",
    department: "Legal",
    domain: "Vendor contracts",
    businessFocus: ["Contract review"],
    technicalFocus: [],
    coreResponsibilities: [],
  },
  ["vendor agreements and NDAs"],
  null,
  null,
);

const legalMission = synthesizeMission(legalInput);
assert.match(legalMission, /contract review|vendor contracts/i);

console.log("brief-synthesis: ok");
