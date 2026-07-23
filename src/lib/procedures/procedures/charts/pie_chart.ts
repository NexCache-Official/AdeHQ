import type { ProcedureHandler } from "../../contracts";
import type { ChartSpec } from "./bar_chart";

export function buildPieChartSpec(input: {
  title?: string;
  labels?: string[];
  values?: number[];
  seriesLabel?: string;
}): ChartSpec {
  return {
    type: "pie",
    title: input.title,
    labels: (input.labels ?? []).map(String),
    datasets: [
      {
        label: input.seriesLabel ?? "Share",
        values: (input.values ?? []).map((v) => Number(v) || 0),
      },
    ],
  };
}

export const pie_chart: ProcedureHandler = (input) => {
  const chart = buildPieChartSpec(input as Parameters<typeof buildPieChartSpec>[0]);
  return { ok: true, output: { chart } };
};
