import type { ProcedureHandler } from "../../contracts";
import { asTable } from "./types";

export type ColumnProfile = {
  name: string;
  nonNull: number;
  nulls: number;
  unique: number;
  inferredType: "number" | "boolean" | "string" | "mixed" | "empty";
  sampleValues: unknown[];
};

export function profileTable(tableInput: unknown): {
  columns: ColumnProfile[];
  rowCount: number;
} {
  const table = asTable(tableInput);
  const profiles: ColumnProfile[] = table.columns.map((name) => {
    const values = table.rows.map((r) => r[name]);
    const nonNullValues = values.filter((v) => v !== null && v !== undefined && v !== "");
    const unique = new Set(nonNullValues.map((v) => JSON.stringify(v))).size;
    const types = new Set(
      nonNullValues.map((v) => {
        if (typeof v === "boolean") return "boolean";
        if (typeof v === "number") return "number";
        if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return "number";
        if (typeof v === "string" && /^(true|false)$/i.test(v.trim())) return "boolean";
        return "string";
      }),
    );
    let inferredType: ColumnProfile["inferredType"] = "empty";
    if (types.size === 0) inferredType = "empty";
    else if (types.size === 1) inferredType = [...types][0] as ColumnProfile["inferredType"];
    else inferredType = "mixed";

    return {
      name,
      nonNull: nonNullValues.length,
      nulls: values.length - nonNullValues.length,
      unique,
      inferredType,
      sampleValues: nonNullValues.slice(0, 5),
    };
  });
  return { columns: profiles, rowCount: table.rows.length };
}

export const profile_table: ProcedureHandler = (input) => {
  const profile = profileTable(input.table ?? input);
  return { ok: true, output: { profile } };
};
