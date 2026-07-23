import type { ProcedureHandler } from "../../contracts";

type JsonSchemaLite = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaLite>;
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchemaLite | undefined,
  path = "$",
): string[] {
  const errors: string[] = [];
  if (!schema) return errors;

  if (schema.type) {
    const actual = typeOf(value);
    const expected = schema.type;
    const ok =
      expected === actual ||
      (expected === "object" && actual === "object") ||
      (expected === "integer" && actual === "number" && Number.isInteger(value));
    if (!ok) errors.push(`${path}: expected ${expected}, got ${actual}`);
  }

  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: missing required property ${key}`);
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(obj[key], propSchema, `${path}.${key}`));
      }
    }
  }

  return errors;
}

export const validate_schema: ProcedureHandler = (input) => {
  const schema = (input.schema ?? input.inputSchema) as JsonSchemaLite | undefined;
  const value = input.value ?? input.data ?? input.payload;
  const errors = validateAgainstSchema(value, schema);
  return {
    ok: errors.length === 0,
    output: { valid: errors.length === 0, errors },
    errorCode: errors.length ? "schema_invalid" : undefined,
    safeErrorMessage: errors.length ? "Schema validation failed" : undefined,
  };
};
