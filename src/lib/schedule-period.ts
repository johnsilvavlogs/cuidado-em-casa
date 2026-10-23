import type { DraftItem, SchedulePeriod } from "./contracts";

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validPeriod(period: SchedulePeriod | undefined): period is SchedulePeriod {
  return !!period && isCalendarDate(period.startDate) && (period.endDate === null || (isCalendarDate(period.endDate) && period.endDate >= period.startDate));
}

// A medication without reviewed period metadata must not recur indefinitely.
// Do not derive dates or duration from clinical free text.
export function scheduledOnDate(item: DraftItem, date: string): boolean {
  const period = item.schedule?.period;
  if (!period) return item.category !== "medication";
  return validPeriod(period) && date >= period.startDate && (period.endDate === null || date <= period.endDate);
}

export function periodLabel(period: SchedulePeriod): string {
  const format = (value: string) => value.split("-").reverse().join("/");
  return `${format(period.startDate)} a ${period.endDate ? format(period.endDate) + " (inclusive)" : "sem término definido na orientação"}`;
}
