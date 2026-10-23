import type { CheckIn, SleepRange } from "./contracts";

export const sleepRangeLabels: Record<SleepRange, string> = {
  under4: "Menos de 4 horas",
  around6: "Cerca de 6 horas",
  "8plus": "8 horas ou mais",
};

/** Keep an approximate report approximate; never derive minutes from its range. */
export function sleepDurationLabel(report: Pick<CheckIn, "sleepMinutes" | "sleepRange">): string | null {
  if (report.sleepRange) return sleepRangeLabels[report.sleepRange];
  if (report.sleepMinutes === null) return null;
  return `${Math.floor(report.sleepMinutes / 60)}h${String(report.sleepMinutes % 60).padStart(2, "0")}`;
}
