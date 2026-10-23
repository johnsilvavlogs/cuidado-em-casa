import type { DraftItem, SchedulePeriod, ScheduleRecurrence } from "./contracts";

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validPeriod(period: SchedulePeriod | undefined): period is SchedulePeriod {
  return !!period && isCalendarDate(period.startDate) && (period.endDate === null || (isCalendarDate(period.endDate) && period.endDate >= period.startDate));
}

export function validRecurrence(recurrence: ScheduleRecurrence | undefined): recurrence is ScheduleRecurrence {
  if (!recurrence) return false;
  if (recurrence.kind === "daily" || recurrence.kind === "reference") return true;
  if (recurrence.kind === "weekly") return recurrence.weekdays.length > 0 && recurrence.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(recurrence.weekdays).size === recurrence.weekdays.length;
  return recurrence.kind === "dates" && recurrence.dates.length > 0 && recurrence.dates.every(isCalendarDate) && new Set(recurrence.dates).size === recurrence.dates.length;
}

export function hasReviewedSchedule(item: DraftItem): boolean {
  if (item.category === "medication") return validPeriod(item.schedule?.period);
  const recurrence = item.schedule?.recurrence;
  return validRecurrence(recurrence) && ((recurrence.kind === "reference" || recurrence.kind === "dates") || validPeriod(item.schedule?.period));
}

// Only explicit, human-reviewed dates create occurrences. Never interpret clinical prose.
export function scheduledOnDate(item: DraftItem, date: string): boolean {
  if (!isCalendarDate(date) || !hasReviewedSchedule(item)) return false;
  const period = item.schedule?.period;
  if (period && (!validPeriod(period) || date < period.startDate || (period.endDate !== null && date > period.endDate))) return false;
  if (item.category === "medication") return true;
  const recurrence = item.schedule!.recurrence!;
  if (recurrence.kind === "reference") return false;
  if (recurrence.kind === "dates") return recurrence.dates.includes(date);
  if (recurrence.kind === "weekly") return recurrence.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  return true;
}

export const weekdayLabels = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function recurrenceLabel(recurrence: ScheduleRecurrence): string {
  if (recurrence.kind === "reference") return "Somente consulta, sem tarefas";
  if (recurrence.kind === "daily") return "Todos os dias do período";
  if (recurrence.kind === "weekly") return recurrence.weekdays.map((day) => weekdayLabels[day]).join(", ");
  return recurrence.dates.map((date) => date.split("-").reverse().join("/")).join(", ");
}

export function periodLabel(period: SchedulePeriod): string {
  const format = (value: string) => value.split("-").reverse().join("/");
  return `${format(period.startDate)} a ${period.endDate ? format(period.endDate) + " (inclusive)" : "sem término definido na orientação"}`;
}
