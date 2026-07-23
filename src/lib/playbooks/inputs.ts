import type { PlaybookInputBinding } from "./contracts";

export type StepInputContext = {
  runInput?: Record<string, unknown>;
  stepOutputs?: Record<string, unknown>;
  roomContext?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
};

const PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$|^[0-9]+$/;

/** Safe dotted/bracket-free path read — no eval. */
export function getByPath(root: unknown, path: string): unknown {
  if (!path || path === ".") return root;
  const segments = path.split(".").filter(Boolean);
  let cur: unknown = root;
  for (const segment of segments) {
    if (!PATH_SEGMENT.test(segment)) {
      throw new Error(`Unsafe path segment: ${segment}`);
    }
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else {
      cur = (cur as Record<string, unknown>)[segment];
    }
  }
  return cur;
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return;
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]!;
    if (!PATH_SEGMENT.test(seg)) throw new Error(`Unsafe path segment: ${seg}`);
    const next = cur[seg];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1]!;
  if (!PATH_SEGMENT.test(last)) throw new Error(`Unsafe path segment: ${last}`);
  cur[last] = value;
}

function readSource(binding: PlaybookInputBinding, context: StepInputContext): unknown {
  switch (binding.source) {
    case "run_input":
      return getByPath(context.runInput ?? {}, binding.path);
    case "step_output": {
      if (!binding.stepKey) throw new Error("step_output binding requires stepKey");
      const stepOut = context.stepOutputs?.[binding.stepKey];
      return getByPath(stepOut, binding.path);
    }
    case "room_context":
      return getByPath(context.roomContext ?? {}, binding.path);
    case "artifact": {
      const key = binding.artifactKey ?? binding.path.split(".")[0];
      if (!key) return undefined;
      const artifactRoot =
        binding.artifactKey != null
          ? context.artifacts?.[binding.artifactKey]
          : context.artifacts;
      const path =
        binding.artifactKey != null
          ? binding.path
          : binding.path.includes(".")
            ? binding.path.slice(binding.path.indexOf(".") + 1)
            : ".";
      return getByPath(artifactRoot, path);
    }
    default:
      throw new Error(`Unsupported binding source: ${String((binding as { source: string }).source)}`);
  }
}

/**
 * Resolve step inputs from declared bindings only.
 * Supported sources: run_input | step_output | room_context | artifact.
 * No eval / no arbitrary code.
 */
export function resolveStepInputs(
  bindings: PlaybookInputBinding[] | undefined,
  context: StepInputContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!bindings?.length) return out;

  for (const binding of bindings) {
    const value = readSource(binding, context);
    setByPath(out, binding.target, value);
  }
  return out;
}
