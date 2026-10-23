import assert from "node:assert/strict";
import { test } from "node:test";
import { endDateForDuration, suggestMedicationPeriod, todayInBrazil } from "../../src/lib/schedule-suggestion";
import type { DraftItem } from "../../src/lib/contracts";

function medication(value = "até 3 dias", sourceText = "até 3 dias"): DraftItem {
  return { id: "med", title: "Paracetamol", category: "medication", instruction: "Tomar se houver dor, por até 3 dias.", fields: { duracao: { value, sourceText, state: "readable" } }, source: { documentId: "doc", page: 1, quote: "Tomar se houver dor, por até 3 dias." }, questions: [], confirmed: false };
}

test("three days count today inclusively and preserve upper bound and original instructions", () => {
  const item = medication(); const original = structuredClone(item);
  assert.deepEqual(suggestMedicationPeriod(item, "2026-10-23"), { period: { startDate: "2026-10-23", endDate: "2026-10-25" }, days: 3, durationLabel: "até 3 dias", sourceText: "até 3 dias" });
  assert.deepEqual(item, original);
  assert.equal(item.schedule, undefined);
  assert.equal(item.confirmed, false);
});

test("weeks, month transitions, leap years and Brazil's calendar date use calendar arithmetic", () => {
  const item = medication("duas semanas", "durante duas semanas");
  item.instruction = item.source.quote = "Tomar durante duas semanas.";
  assert.equal(suggestMedicationPeriod(item, "2026-01-25")?.period.endDate, "2026-02-07");
  assert.equal(endDateForDuration("2026-01-31", 3), "2026-02-02");
  assert.equal(endDateForDuration("2028-02-28", 3), "2028-03-01");
  assert.equal(todayInBrazil(new Date("2026-10-23T01:00:00Z")), "2026-10-22");
});

test("existing reviewed dates win and other care categories never receive this suggestion", () => {
  const item = medication();
  item.schedule = { times: [], priority: "normal", toleranceMinutes: 0, period: { startDate: "2026-10-01", endDate: "2026-10-03" } };
  assert.equal(suggestMedicationPeriod(item, "2026-10-23"), null);
  assert.equal(suggestMedicationPeriod({ ...medication(), category: "activity" }, "2026-10-23"), null);
});

test("missing structure can use one explicit source duration, but frequency is not duration", () => {
  const item = medication(); item.fields = {};
  assert.equal(suggestMedicationPeriod(item, "2026-10-23")?.days, 3);
  item.instruction = item.source.quote = "Tomar a cada 3 dias. Retornar em 7 dias.";
  assert.equal(suggestMedicationPeriod(item, "2026-10-23"), null);
});

test("ambiguous, conflicting, ranged, indefinite and month-based durations remain manual", () => {
  const ambiguous = medication(); ambiguous.fields.duracao.state = "ambiguous";
  const conflicting = medication(); conflicting.instruction = "Tomar por 5 dias.";
  const multiple = medication(); multiple.instruction = "Tomar por 3 dias e depois por 2 dias.";
  const question = medication(); question.questions = ["Confirmar a duração no original."];
  for (const item of [ambiguous, conflicting, multiple, question, medication("3 a 5 dias"), medication("1 mês"), medication("uso contínuo")]) assert.equal(suggestMedicationPeriod(item, "2026-10-23"), null);
  assert.equal(endDateForDuration("2026-02-30", 3), null);
});
