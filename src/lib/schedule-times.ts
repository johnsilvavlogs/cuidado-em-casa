import type { DraftItem } from "./contracts";

export type TimeOrigin = "source" | "suggested" | "caregiver";
export type TimeProposal = { times: string[]; origin: TimeOrigin; note: string };
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function sourceText(item: DraftItem): string {
  return normalize([item.instruction, item.source.quote, ...Object.values(item.fields).filter(field => field.state === "readable").flatMap(field => [field.value, field.sourceText])].filter(Boolean).join("\n"));
}
export function isConditionalCare(item: DraftItem): boolean {
  return /\b(se necessario|em caso de (?:dor|necessidade)|quando sentir (?:dor|necessidade)|sob demanda|sos)\b/.test(sourceText(item)) || /\b(?:tomar|usar|aplicar|administrar|realizar|fazer)[^.;\n]{0,160}\bse (?:houver|tiver|sentir)\b/.test(sourceText(item));
}
export function isReferenceCare(item: DraftItem): boolean {
  return item.schedule?.recurrence?.kind === "reference" || isConditionalCare(item);
}
function frequency(item: DraftItem): { count?: number; interval?: number; unsupported?: boolean } {
  const text = sourceText(item);
  const intervals = [...text.matchAll(/(?:a cada|de)\s*(\d+)\s*(?:em\s*\1\s*)?(?:horas?|h)\b|\b(\d+)\s*\/\s*\2\s*h(?:oras?)?\b/g)].map(match => Number(match[1] ?? match[2]));
  const unique = [...new Set(intervals)];
  if (unique.length > 1) return { unsupported: true };
  if (unique.length === 1) return unique[0] > 0 && 24 % unique[0] === 0 ? { count: 24 / unique[0], interval: unique[0] } : { unsupported: true };
  if (/\ba cada\s*\d+\s*dias?\b|\bdias? alternados?\b/.test(text)) return { unsupported: true };
  const words: Record<string, number> = { uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
  const counts = [...text.matchAll(/\b(\d+|uma|um|duas|dois|tres|quatro|cinco|seis)\s*(?:vez(?:es)?|x)\s*(?:ao|por|no|\/)?\s*dia\b/g)].map(match => words[match[1]] ?? Number(match[1]));
  if (/\b(?:uma vez|diariamente|diario|todas? as? manhas|todas? as? noites)\b/.test(text)) counts.push(1);
  const uniqueCounts = [...new Set(counts)];
  if (uniqueCounts.length > 1 || uniqueCounts.some(count => count < 1 || count > 6)) return { unsupported: true };
  return { count: uniqueCounts[0] };
}
function explicitTimes(item: DraftItem): string[] {
  // Remove interval notation before collecting literal clock readings.
  const text = sourceText(item).replace(/(?:a cada|de)\s*(\d+)\s*(?:em\s*\1\s*)?(?:horas?|h)\b|\b(\d+)\s*\/\s*\2\s*h(?:oras?)?\b/g, "");
  const spoken = [...text.matchAll(/\bas\s+([01]?\d|2[0-3])(?:\s+horas?)?\b(?!:)/g)].map(match => `${match[1].padStart(2, "0")}:00`);
  const values = [...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b|(?<![\d/])\b([01]?\d|2[0-3])h(?:([0-5]\d))?\b/g)].map(match => `${(match[1] ?? match[3]).padStart(2, "0")}:${match[2] ?? match[4] ?? "00"}`);
  return [...new Set([...values, ...spoken])].sort();
}
export function proposeTimes(item: DraftItem): TimeProposal {
  if (isReferenceCare(item)) return { times: [], origin: "suggested", note: "Cuidado eventual ou de referência: permanece no plano, sem tarefa obrigatória." };
  const explicit = explicitTimes(item);
  const rule = frequency(item);
  if (explicit.length === 1 && rule.interval && rule.count && rule.count > 1) {
    const start = Number(explicit[0].slice(0, 2)) * 60 + Number(explicit[0].slice(3));
    const times = Array.from({ length: rule.count }, (_, index) => (start + index * rule.interval! * 60) % 1440).map(value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`).sort();
    return { times, origin: "suggested", note: `Sugestão com intervalo de ${rule.interval} horas, preservando ${explicit[0]} da fonte como início. Confira antes de confirmar.` };
  }
  if (explicit.length) return { times: explicit, origin: "source", note: "Horários identificados no texto da orientação. Confira com a fonte." };
  if (rule.unsupported) return { times: [], origin: "suggested", note: "A frequência precisa de conferência. O aplicativo não propõe horários para este intervalo." };
  const text = sourceText(item);
  if (/\b(antes|apos|depois) (?:de |do |da |das |dos )?(?:refeic|almoco|jantar|cafe)|\bjejum\b/.test(text)) return { times: [], origin: "suggested", note: "O horário depende das refeições ou do jejum. Informe horários compatíveis com a rotina e com a fonte antes de confirmar." };
  const anchors = [...new Set([/\b(manha|cafe da manha)\b/.test(text) ? 8 : null, /\balmoco\b/.test(text) ? 12 : null, /\bjantar\b/.test(text) ? 19 : null, /\b(noite|dormir)\b/.test(text) ? 21 : null, /\bacordar\b/.test(text) ? 7 : null].filter((value): value is number => value !== null))];
  if (anchors.length && !rule.interval) {
    if (rule.count && rule.count !== anchors.length) return { times: [], origin: "suggested", note: "Confira como distribuir a frequência nos períodos indicados pela fonte." };
    return { times: anchors.map(hour => `${String(hour).padStart(2, "0")}:00`).sort(), origin: "suggested", note: "Sugestão nos períodos indicados pela fonte. Ajuste à rotina antes de confirmar." };
  }
  const count = rule.count ?? (item.category === "medication" && !/\b(manha|noite|dormir|acordar|almoco|jantar|cafe da manha)\b/.test(text) ? 0 : 1);
  if (!count) return { times: [], origin: "suggested", note: "Confira a frequência e informe os horários para este medicamento." };
  let hours: number[];
  if (rule.interval) hours = Array.from({ length: count }, (_, index) => (8 + index * rule.interval!) % 24);
  else if (count > 1) hours = Array.from({ length: count }, (_, index) => Math.round(8 + index * 12 / (count - 1)));
  else hours = [/\b(noite|dormir)\b/.test(text) ? 21 : /\bjantar\b/.test(text) ? 19 : /\balmoco\b/.test(text) ? 12 : /\bacordar\b/.test(text) ? 7 : /\b(manha|cafe da manha)\b/.test(text) ? 8 : 9];
  return { times: hours.map(hour => `${String(hour).padStart(2, "0")}:00`).sort(), origin: "suggested", note: rule.interval ? `Sugestão de organização com intervalo de ${rule.interval} horas. Ajuste o início conforme a rotina e a fonte.` : "Sugestão de organização da rotina, não extraída da receita. Confira refeições, sono e outras condições antes de confirmar." };
}
export function withProposedTimes(item: DraftItem): DraftItem {
  if (item.schedule?.times.length) return item;
  const proposal = proposeTimes(item);
  return { ...item, schedule: { priority: "normal", toleranceMinutes: 30, ...item.schedule, times: proposal.times, timeOrigin: proposal.origin } };
}
export function timeBlocker(item: DraftItem): string | null {
  if (isReferenceCare(item)) return null;
  const times = item.schedule?.times ?? [];
  if (!times.length || times.some(time => !clock.test(time)) || new Set(times).size !== times.length) return "Confira os horários da rotina antes de confirmar este cuidado.";
  const rule = frequency(item);
  if (rule.unsupported) return "A frequência não cabe na agenda diária. Mantenha este cuidado como referência até esclarecer a agenda com o responsável.";
  if (rule.count && times.length !== rule.count) return `A orientação prevê ${rule.count} horário(s) por dia. Confira a quantidade informada.`;
  if (rule.interval && times.length > 1) {
    const minutes = times.map(time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))).sort((a, b) => a - b);
    if (minutes.some((value, index) => ((minutes[(index + 1) % minutes.length] - value + 1440) % 1440) !== rule.interval! * 60)) return `Preserve o intervalo de ${rule.interval} horas entre os horários.`;
  }
  return null;
}
export function hasExecutableTimes(item: DraftItem): boolean {
  return !isReferenceCare(item) && timeBlocker(item) === null;
}
