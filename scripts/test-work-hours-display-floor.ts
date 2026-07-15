import { floorDisplayHours, floorDisplayTree } from "@/lib/billing/usage/round-display";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(floorDisplayHours(0.079) === 0.07, "0.079 floors to 0.07");
assert(floorDisplayHours(0.009) === 0, "0.009 floors to 0");

const { rows, total } = floorDisplayTree([
  { key: "a", workHours: 0.006 },
  { key: "b", workHours: 0.007 },
  { key: "c", workHours: 0.008 },
]);
assert(total === 0.02, `expected floored raw total 0.02, got ${total}`);
assert(rows.length === 0, "sub-cent leaves should disappear from breakdown rows");

console.log("work-hours display floor: ok");
