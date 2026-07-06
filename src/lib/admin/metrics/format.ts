export function formatAdminUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "$0.00";
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatAdminCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

export function formatAdminDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatAdminBytes(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}
