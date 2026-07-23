import type { ProcedureHandler } from "../../contracts";
import type { ChartSpec } from "./bar_chart";

export function buildLineChartSpec(input: {
  title?: string;
  labels?: string[];
  values?: number[];
  seriesLabel?: string;
  datasets?: Array<{ label: string; values: number[] }>;
}): ChartSpec {
  const labels = (input.labels ?? []).map(String);
  const datasets =
    input.datasets?.map((d) => ({
      label: String(d.label),
      values: d.values.map((v) => Number(v) || 0),
    })) ?? [
      {
        label: input.seriesLabel ?? "Series",
        values: (input.values ?? []).map((v) => Number(v) || 0),
      },
    ];
  return { type: "line", title: input.title, labels, datasets };
}

export const line_chart: ProcedureHandler = (input) => {
  const chart = buildLineChartSpec(input as Parameters<typeof buildLineChartSpec>[0]);
  return { ok: true, output: { chart } };
};
