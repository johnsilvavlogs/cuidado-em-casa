import type { DraftItem, SchedulePeriod } from "./contracts";
import { isCalendarDate, validPeriod } from "./schedule-period";

export type MedicationPeriodSuggestion = { period: SchedulePeriod; days: number; durationLabel: string; sourceText: string };
const numbers: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, vinte: 20, trinta: 30 };
const amount = `(?:[1-9]\\d{0,3}|${Object.keys(numbers).join("|")})`;
const duration = `(?<limit>ate\\s+)?(?<amount>${amount})\\s+(?<unit>dias?|semanas?)`;
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
type Candidate = { days: number; label: string; sourceText: string; limit: boolean };

function candidate(match: RegExpMatchArray, sourceText: string): Candidate {
  const count = numbers[match.groups!.amount] ?? Number(match.groups!.amount);
  const weeks = match.groups!.unit.startsWith("semana");
  return { days: count * (weeks ? 7 : 1), label: `${match.groups!.limit ? "até " : ""}${count} ${weeks ? count === 1 ? "semana" : "semanas" : count === 1 ? "dia" : "dias"}`, sourceText: sourceText.trim(), limit: !!match.groups!.limit };
}

function wholeDuration(text: string): Candidate | null {
  const match = normalized(text).trim().match(new RegExp(`^(?:(?:por|durante)\\s+)?${duration}[.!]?$`));
  return match ? candidate(match, text) : null;
}

/** Calendar arithmetic only: the starting day counts as day one. */
export function endDateForDuration(startDate: string, days: number): string | null {
  if (!isCalendarDate(startDate) || !Number.isSafeInteger(days) || days < 1) return null;
  const date = new Date(`${startDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days - 1);
  const result = date.toISOString().slice(0, 10);
  return isCalendarDate(result) ? result : null;
}

export function todayInBrazil(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Suggest only explicit, agreeing medication durations; never mutates or confirms the item. */
export function suggestMedicationPeriod(item: DraftItem, startDate = todayInBrazil()): MedicationPeriodSuggestion | null {
  if (item.category !== "medication" || validPeriod(item.schedule?.period) || !isCalendarDate(startDate)) return null;
  if (item.questions.some(question => /duracao|quantos dias|prazo|inicio|termino|periodo/.test(normalized(question)))) return null;
  const candidates: Candidate[] = [];
  for (const [key, field] of Object.entries(item.fields)) {
    if (!["duracao", "duration"].includes(normalized(key))) continue;
    if (field.state === "ambiguous" || field.state === "illegible") return null;
    if (field.state === "missing") continue;
    const value = wholeDuration(field.value ?? "");
    const source = wholeDuration(field.sourceText ?? "");
    if (!value || !source || value.days !== source.days) return null;
    candidates.push(value, source);
  }
  for (const text of [item.source.quote, item.instruction]) {
    if (!text) continue;
    const plain = normalized(text);
    // Explicit alternative/ranged durations and unsupported months stay for manual review.
    if (new RegExp(`(?:${amount})\\s*(?:(?:dias?|semanas?)\\s*)?(?:a|ou|[-–/])\\s*(?:${amount})\\s*(?:dias?|semanas?)`).test(plain)
      || /(?:por|durante)\s+(?:ate\s+)?\S+\s+mes(?:es)?\b/.test(plain)) return null;
    const matches = [...plain.matchAll(new RegExp(`\\b(?:por|durante)\\s+${duration}\\b`, "g"))];
    if (matches.length > 1) return null;
    for (const match of matches) {
      // Preserve the literal source substring, including accents, rather than normalized text.
      const literal = text.slice(match.index!, match.index! + match[0].length);
      candidates.push(candidate(match, literal));
    }
  }
  if (!candidates.length || new Set(candidates.map(value => value.days)).size !== 1) return null;
  const selected = candidates.find(value => value.limit) ?? candidates[0];
  const endDate = endDateForDuration(startDate, selected.days);
  if (!endDate) return null;
  return { period: { startDate, endDate }, days: selected.days, durationLabel: selected.label, sourceText: selected.sourceText };
}
