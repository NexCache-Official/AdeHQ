import type { ProcedureHandler } from "../../contracts";

export type ChartSpec = {
  type: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  datasets: Array<{ label: string; values: number[] }>;
};

/** Return a chart spec JSON — never executable scripts. */
export function buildBarChartSpec(input: {
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
  return { type: "bar", title: input.title, labels, datasets };
}

export const bar_chart: ProcedureHandler = (input) => {
  const chart = buildBarChartSpec(input as Parameters<typeof buildBarChartSpec>[0]);
  return { ok: true, output: { chart } };
};
